"""
生成乐团演员（写实人体，CC0）：用 MakeHuman 的 Blender 插件 MPFB2 生成人体，挂 Mixamo 骨骼，
再用 MakeHuman 基础网格自带的辅助几何（紧身衣壳、裙子壳、头发壳、眼球）做成演出服和头发，
导出 Draco 压缩的 GLB 到 public/models/，并写好 cast.json。

MPFB2 的代码是 GPLv3，但它生成的人体和自带素材是 CC0，可以公开部署。
本脚本不依赖 MakeHuman 网站上的素材包（服装、头发、皮肤贴图），全部用基础网格现做。

运行方法（需要 Blender 4.2 的 Python 模块 bpy，以及已安装为 Blender 扩展的 MPFB2）：
    python scripts/make_cast.py            # 生成全部人物
    python scripts/make_cast.py man-1      # 只重新生成某一个
然后用 gltf-transform 做 Draco 压缩（每个约 125 KB）：
    npx @gltf-transform/cli draco public/models/man-1.glb public/models/man-1.glb

MPFB2 只在生成时使用，网站本身不包含也不分发它的代码。
"""

import importlib
import json
import math
import os
import sys

import bpy  # noqa: E402  bpy 必须先于 bmesh 导入
import bmesh
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models")

# ——— 演员表：每人的体型参数（MakeHuman 宏参数，0~1）和外观 ———
CAST = [
    # 男：燕尾服 / 黑西装
    dict(id="man-1", gender=1.0, age=0.55, weight=0.5, muscle=0.55, height=0.6, race=(0.2, 0.7, 0.1),
         skin=(0.80, 0.62, 0.52), hair="short", hair_color=(0.10, 0.07, 0.05), roles=["strings", "choir", "timpani", "organ"]),
    dict(id="man-2", gender=1.0, age=0.7, weight=0.6, muscle=0.45, height=0.5, race=(0.7, 0.2, 0.1),
         skin=(0.78, 0.60, 0.46), hair="short", hair_color=(0.05, 0.05, 0.05), roles=["strings", "choir", "timpani", "organ"]),
    dict(id="man-3", gender=1.0, age=0.6, weight=0.45, muscle=0.5, height=0.65, race=(0.05, 0.15, 0.8),
         skin=(0.42, 0.28, 0.20), hair="short", hair_color=(0.04, 0.03, 0.03), roles=["strings", "choir", "timpani"]),
    dict(id="conductor", gender=1.0, age=0.88, weight=0.55, muscle=0.45, height=0.6, race=(0.1, 0.85, 0.05),
         skin=(0.82, 0.64, 0.55), hair="short", hair_color=(0.62, 0.60, 0.57), roles=["conductor"]),
    # 女：黑色长裙（合唱）/ 黑色正装（弦乐）
    dict(id="woman-1", gender=0.0, age=0.5, weight=0.45, muscle=0.45, height=0.55, race=(0.2, 0.75, 0.05),
         skin=(0.85, 0.68, 0.58), hair="long", hair_color=(0.20, 0.12, 0.07), roles=["strings", "choir"]),
    dict(id="woman-2", gender=0.0, age=0.6, weight=0.5, muscle=0.4, height=0.45, race=(0.8, 0.15, 0.05),
         skin=(0.83, 0.66, 0.52), hair="bun", hair_color=(0.04, 0.04, 0.05), roles=["strings", "choir"]),
    dict(id="woman-3", gender=0.0, age=0.55, weight=0.55, muscle=0.45, height=0.5, race=(0.05, 0.2, 0.75),
         skin=(0.40, 0.26, 0.19), hair="bun", hair_color=(0.03, 0.03, 0.03), roles=["strings", "choir"]),
]

SUIT = (0.012, 0.012, 0.015)
SHIRT = (0.85, 0.84, 0.80)
SHOE = (0.01, 0.01, 0.01)


def boot():
    """在无界面 Blender 里启用 MPFB2，返回 HumanService"""
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    for m in list(sys.modules):
        if m.endswith("mpfb.services.humanservice"):
            return importlib.import_module(m).HumanService
    raise RuntimeError("找不到 MPFB2，请先把它安装为 Blender 扩展")


def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def material(name, color, roughness=0.6, metallic=0.0):
    """color 是 sRGB（和网页里看到的颜色一致），Blender 需要线性值"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(color), 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def group_members(obj, name, threshold=0.5):
    g = obj.vertex_groups.get(name)
    if g is None:
        return set()
    return {v.index for v in obj.data.vertices if any(e.group == g.index and e.weight > threshold for e in v.groups)}


def dominant_bone(obj, vert):
    """顶点权重最大的骨骼名（去掉 mixamorig 前缀）"""
    best, name = 0.0, ""
    for e in vert.groups:
        g = obj.vertex_groups[e.group].name
        if g.startswith("mixamorig") and e.weight > best:
            best, name = e.weight, g.split(":")[-1]
    return name


def build(HumanService, spec):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    woman = spec["gender"] < 0.5
    asian, caucasian, african = spec["race"]
    body = HumanService.create_human(macro_detail_dict={
        "gender": spec["gender"], "age": spec["age"], "muscle": spec["muscle"], "weight": spec["weight"],
        "proportions": 0.75, "height": spec["height"], "cupsize": 0.5, "firmness": 0.5,
        "race": {"asian": asian, "caucasian": caucasian, "african": african},
    })
    rig = HumanService.add_builtin_rig(body, "mixamo")

    # 把体型形状键固化进网格，去掉隐藏辅助几何的遮罩
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    if body.data.shape_keys:
        body.shape_key_add(name="mix", from_mix=True)
        mix = body.data.shape_keys.key_blocks["mix"]
        for v, p in zip(body.data.vertices, mix.data):
            v.co = p.co.copy()
        body.shape_key_clear()
    for m in list(body.modifiers):
        if m.type == "MASK":
            body.modifiers.remove(m)

    skin_ids = group_members(body, "body")
    tights = group_members(body, "helper-tights")
    skirt = group_members(body, "helper-skirt")
    hair = group_members(body, "helper-hair")
    eyes = group_members(body, "helper-l-eye") | group_members(body, "helper-r-eye")
    lashes = set()
    for n in ["helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2"]:
        lashes |= group_members(body, n)
    verts = body.data.vertices
    head_top = max(verts[i].co.z for i in skin_ids)

    # 每个顶点的主导骨骼
    bone_of = {v.index: dominant_bone(body, v) for v in verts}
    exposed_bones = {"Head", "HeadTop_End", "LeftEye", "RightEye"}
    hand_bones = {b for b in set(bone_of.values()) if "Hand" in b}
    foot_bones = {"LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase", "LeftToe_End", "RightToe_End"}
    neck_z = max(verts[i].co.z for i in tights) - 0.01  # 紧身衣壳的领口高度

    mats = {
        "skin": material("skin", spec["skin"], 0.55),
        "suit": material("suit", SUIT, 0.72),
        "shirt": material("shirt", SHIRT, 0.6),
        "shoes": material("shoes", SHOE, 0.25),
        "hair": material("hair", spec["hair_color"], 0.5),
        "eye": material("eye", (0.08, 0.06, 0.05), 0.1),
    }
    order = list(mats)
    for m in mats.values():
        body.data.materials.append(m)

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    def face_in(face, ids):
        return all(v.index in ids for v in face.verts)

    kill = []
    for f in bm.faces:
        idx = {v.index for v in f.verts}
        if face_in(f, eyes):
            f.material_index = order.index("eye")
        elif face_in(f, lashes):
            f.material_index = order.index("hair")
        elif face_in(f, hair):
            keep = True
            zc = sum(v.co.z for v in f.verts) / len(f.verts)
            yc = sum(v.co.y for v in f.verts) / len(f.verts)
            # 基础网格面朝 -y：y 越小越靠前（脸），越大越靠后（后脑）
            if yc < -0.07 and zc < head_top - 0.045:
                keep = False  # 前额以下的刘海去掉，露出脸
            elif spec["hair"] == "short":
                # 短发：头顶到耳朵上方，后脑到发际线
                keep = zc > head_top - 0.1 or (yc > -0.01 and zc > head_top - 0.19)
            elif spec["hair"] == "bun":
                # 盘发：贴头皮，后面收到后颈
                keep = zc > head_top - 0.12 or (yc > -0.02 and zc > head_top - 0.2)
            if keep:
                f.material_index = order.index("hair")
            else:
                kill.append(f)
        elif face_in(f, skirt):
            if woman and "choir" in spec["roles"]:
                f.material_index = order.index("suit")
            else:
                kill.append(f)
        elif face_in(f, tights):
            cz = sum(v.co.z for v in f.verts) / len(f.verts)
            cx = sum(v.co.x for v in f.verts) / len(f.verts)
            cy = sum(v.co.y for v in f.verts) / len(f.verts)
            bones = {bone_of[i] for i in idx}
            front = cy < -0.05
            if bones & foot_bones:
                f.material_index = order.index("shoes")
            elif not woman and front and abs(cx) < 0.03 and neck_z - 0.045 < cz < neck_z - 0.018:
                f.material_index = order.index("suit")  # 黑色领结
            elif not woman and cz > neck_z - 0.02:
                f.material_index = order.index("shirt")  # 衬衫领子（窄边）
            elif not woman and front and cz > neck_z - 0.2 and abs(cx) < 0.006 + (cz - (neck_z - 0.2)) * 0.22:
                f.material_index = order.index("shirt")  # 西装 V 领里露出的衬衫前襟
            else:
                f.material_index = order.index("suit")
        elif face_in(f, skin_ids):
            bones = {bone_of[i] for i in idx}
            zc = sum(v.co.z for v in f.verts) / len(f.verts)
            # 衣服盖住的皮肤删掉，免得穿模；只留头、脖子上半截、手
            if bones & hand_bones or bones & exposed_bones or zc > neck_z:
                f.material_index = order.index("skin")
            else:
                kill.append(f)
        else:
            kill.append(f)  # 牙齿、舌头、关节辅助方块等
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

    # 衣服往外推一点，和身体之间留出厚度；头发同理
    bm.normal_update()
    push = {order.index("suit"): 0.006, order.index("shirt"): 0.007, order.index("shoes"): 0.004, order.index("hair"): 0.004}
    moved = set()
    for f in bm.faces:
        d = push.get(f.material_index)
        if not d:
            continue
        for v in f.verts:
            if v.index not in moved:
                v.co += v.normal * d
                moved.add(v.index)
    bm.to_mesh(body.data)
    bm.free()

    # 盘发：在后脑加一个发髻，权重全部给头部骨骼
    if spec["hair"] == "bun":
        head = [v for v in body.data.vertices if bone_of.get(v.index) == "Head"]
        cx = sum(v.co.x for v in head) / len(head)
        top = max(v.co.z for v in head)
        back = max(v.co.y for v in head)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, location=(cx, back - 0.01, top - 0.08), segments=20, ring_count=12)
        bun = bpy.context.active_object
        bun.scale = (1.0, 0.85, 0.9)
        bpy.ops.object.transform_apply(scale=True)
        bun.data.materials.append(mats["hair"])
        vg = bun.vertex_groups.new(name="mixamorig:Head")
        vg.add([v.index for v in bun.data.vertices], 1.0, "REPLACE")
        bun.select_set(True)
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()

    # 平滑着色
    for p in body.data.polygons:
        p.use_smooth = True
    return body, rig


def export(body, rig, path):
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
    )


def main():
    HumanService = boot()
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    characters = []
    for spec in CAST:
        if only and spec["id"] not in only:
            continue
        body, rig = build(HumanService, spec)
        file = f"{spec['id']}.glb"
        export(body, rig, os.path.join(OUT, file))
        # 网页里按这个身高缩放（MakeHuman 的宏参数出来的身高差异偏大，这里收拢到常见范围）
        woman = spec["gender"] < 0.5
        height = round((1.58 if woman else 1.70) + spec["height"] * (0.14 if woman else 0.2), 2)
        characters.append({
            "file": file,
            "gender": "woman" if woman else "man",
            "roles": spec["roles"],
            "height": height,
        })
        print("生成", file, "身高", height)
    if not only:
        with open(os.path.join(OUT, "cast.json"), "w", encoding="utf-8") as fh:
            json.dump({"characters": characters}, fh, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
