"""
Meridian asset pipeline (Blender, background mode).

Builds the game's instanced 3D assets procedurally with bmesh and exports each
one as a GLB into public/assets/models/. Optionally renders a preview sheet.

Run:  blender --background --factory-startup --python tools/blender/build_assets.py -- <out_dir> [preview.png]

Material names carry meaning for the game's asset loader:
  Body*      tintable paint (multiplied by per-instance colour)
  Glass*     reflective glass
  Headlight  emissive white at night
  Taillight  emissive red at night
  Lightbar   flashing emergency lights
  Lamp       street lamp (emissive at night)
  anything else keeps its base colour
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0]) if argv else os.path.abspath("public/assets/models")
PREVIEW = os.path.abspath(argv[1]) if len(argv) > 1 else None
os.makedirs(OUT_DIR, exist_ok=True)

random.seed(7)

# ── Materials ───────────────────────────────────────────────────────────────
PALETTE = {
    "Body": (0.82, 0.82, 0.82, 1),
    "BodyAccent": (0.85, 0.85, 0.85, 1),
    "Glass": (0.06, 0.08, 0.1, 1),
    "Tire": (0.03, 0.03, 0.03, 1),
    "Rim": (0.55, 0.56, 0.58, 1),
    "Trim": (0.06, 0.06, 0.065, 1),
    "Chrome": (0.7, 0.7, 0.72, 1),
    "Headlight": (0.95, 0.95, 0.9, 1),
    "Taillight": (0.6, 0.04, 0.03, 1),
    "Lightbar": (0.15, 0.25, 0.9, 1),
    "Stripe": (0.75, 0.08, 0.06, 1),
    "Steel": (0.42, 0.43, 0.45, 1),
    "DarkSteel": (0.16, 0.17, 0.18, 1),
    "Bark": (0.23, 0.17, 0.12, 1),
    "LeafDark": (0.12, 0.24, 0.08, 1),
    "Leaf": (0.2, 0.36, 0.11, 1),
    "LeafLight": (0.3, 0.46, 0.15, 1),
    "MapleLeaf": (0.27, 0.42, 0.12, 1),
    "MapleLeafLight": (0.4, 0.52, 0.17, 1),
    "PineNeedle": (0.09, 0.2, 0.11, 1),
    "PineNeedleLight": (0.13, 0.27, 0.14, 1),
    "BushLeaf": (0.18, 0.3, 0.1, 1),
    "Lamp": (1.0, 0.92, 0.75, 1),
    "Concrete": (0.6, 0.59, 0.56, 1),
    "Yellow": (0.93, 0.68, 0.08, 1),
    "White": (0.92, 0.92, 0.9, 1),
    "SignBlue": (0.05, 0.25, 0.6, 1),
    "Wood": (0.55, 0.38, 0.22, 1),
    "Sail": (0.95, 0.94, 0.9, 1),
    "BoxRed": (0.55, 0.1, 0.07, 1),
    "BoxBlue": (0.06, 0.2, 0.45, 1),
    "BoxGreen": (0.08, 0.32, 0.18, 1),
    "BoxOrange": (0.75, 0.32, 0.06, 1),
    "BoxGrey": (0.45, 0.46, 0.47, 1),
    "BoxTeal": (0.05, 0.38, 0.4, 1),
    "Antifoul": (0.36, 0.07, 0.06, 1),
}


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = PALETTE.get(name, (0.8, 0.8, 0.8, 1))
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = PALETTE.get(name, (0.8, 0.8, 0.8, 1))
        rough = 0.35 if name.startswith("Body") else 0.08 if name.startswith("Glass") else 0.7
        bsdf.inputs["Roughness"].default_value = rough
        if name in ("Chrome", "Rim", "Steel"):
            bsdf.inputs["Metallic"].default_value = 0.8
    return m


class Builder:
    """Accumulates geometry for one asset in a single bmesh with material slots."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mat_index(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag_faces(self, faces, mat, smooth=False):
        idx = self.mat_index(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces

    def _tag(self, verts, mat, smooth=False):
        return self._tag_faces({f for v in verts for f in v.link_faces}, mat, smooth)

    def _bevel_part(self, faces, offset, segments=2, edges=None):
        """Bevels a part's edges. Faces must already carry their material: the
        faces bevel creates inherit it from their neighbours."""
        if edges is None:
            edges = list({e for f in faces for e in f.edges})
        ret = bmesh.ops.bevel(self.bm, geom=edges, offset=offset, offset_type="OFFSET", segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True)
        return {f for f in faces if f.is_valid} | set(ret["faces"])

    def box(self, size, loc, mat, bevel=0.0, rot_z=0.0, segments=2):
        m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Diagonal((size[0], size[1], size[2], 1))
        ret = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        faces = self._tag_faces({f for v in ret["verts"] for f in v.link_faces}, mat)
        if bevel > 0:
            faces = self._bevel_part(faces, bevel, segments)
        return faces

    def cylinder(self, r1, r2, depth, loc, mat, segments=10, axis="Z", smooth=True, caps=True):
        rot = Matrix.Identity(4)
        if axis == "Y":
            rot = Matrix.Rotation(math.pi / 2, 4, "X")
        elif axis == "X":
            rot = Matrix.Rotation(math.pi / 2, 4, "Y")
        m = Matrix.Translation(Vector(loc)) @ rot
        ret = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segments, radius1=r1, radius2=r2, depth=depth, matrix=m)
        return self._tag(ret["verts"], mat, smooth)

    def sphere(self, r, loc, mat, subdiv=1, scale=(1, 1, 1), jitter=0.0, smooth=True):
        m = Matrix.Translation(Vector(loc)) @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))
        ret = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=m)
        if jitter > 0:
            c = Vector(loc)
            for v in ret["verts"]:
                d = (v.co - c)
                v.co = c + d * (1 + random.uniform(-jitter, jitter))
        return self._tag(ret["verts"], mat, smooth)

    def prism(self, profile, width, mat, y0=None, bevel=0.0, segments=2):
        """Extrudes an XZ profile polygon (list of (x, z)) along Y (centred)."""
        y0 = -width / 2 if y0 is None else y0
        bm = self.bm
        a = [bm.verts.new((x, y0, z)) for x, z in profile]
        b = [bm.verts.new((x, y0 + width, z)) for x, z in profile]
        n = len(profile)
        caps = [bm.faces.new(list(reversed(a))), bm.faces.new(b)]
        faces = list(caps)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        faces = self._tag_faces(set(faces), mat)
        if bevel > 0:
            # Round the silhouette edges only; profile corners stay as modelled.
            faces = self._bevel_part(faces, bevel, segments, edges=list({e for f in caps for e in f.edges}))
        return faces

    def frustum(self, bottom, top, mat_roof, mat_side, mat_front=None, mat_back=None):
        """Cabin shape: bottom/top are (x0, x1, half_width, z). Roof uses mat_roof, other faces glass."""
        bm = self.bm
        bx0, bx1, bw, bz = bottom
        tx0, tx1, tw, tz = top
        v = [
            bm.verts.new((bx0, -bw, bz)), bm.verts.new((bx1, -bw, bz)), bm.verts.new((bx1, bw, bz)), bm.verts.new((bx0, bw, bz)),
            bm.verts.new((tx0, -tw, tz)), bm.verts.new((tx1, -tw, tz)), bm.verts.new((tx1, tw, tz)), bm.verts.new((tx0, tw, tz)),
        ]
        roof = bm.faces.new((v[4], v[5], v[6], v[7]))
        front = bm.faces.new((v[1], v[2], v[6], v[5]))
        back = bm.faces.new((v[3], v[0], v[4], v[7]))
        left = bm.faces.new((v[0], v[1], v[5], v[4]))
        right = bm.faces.new((v[2], v[3], v[7], v[6]))
        roof.material_index = self.mat_index(mat_roof)
        for f, m in ((front, mat_front or mat_side), (back, mat_back or mat_side), (left, mat_side), (right, mat_side)):
            f.material_index = self.mat_index(m)
        return v

    def finish(self, smooth_angle=None):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        if smooth_angle is not None:
            try:
                mesh.set_sharp_from_angle(angle=math.radians(smooth_angle))
            except Exception:
                pass
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


# ── Vehicles (forward = +X, origin at ground centre) ───────────────────────
M = material


def wheels(b, xs, half_track, r, width=0.24, dual_rear=False):
    for x in xs:
        for side in (-1, 1):
            y = side * half_track
            b.cylinder(r, r, width, (x, y, r), M("Tire"), segments=12, axis="Y")
            b.cylinder(r * 0.6, r * 0.6, width + 0.02, (x, y, r), M("Rim"), segments=8, axis="Y")
            if dual_rear and x < 0:
                b.cylinder(r, r, width, (x, y - side * 0.28, r), M("Tire"), segments=12, axis="Y")


def arched_profile(bottom_z, wheel_xs, wheel_r, upper, arch_gap=0.07, steps=7):
    """Side profile (x, z) for a body with wheel arches.

    The bottom edge runs rear to front at `bottom_z`, rising around each wheel;
    `upper` lists the rest of the outline from the front bumper back to the rear.
    """
    R = wheel_r + arch_gap
    x_rear = upper[-1][0]
    x_front = upper[0][0]
    pts = [(x_rear, bottom_z)]
    for x in sorted(wheel_xs):
        pts.append((x - R, bottom_z))
        for k in range(steps + 1):
            t = math.pi - math.pi * k / steps
            pts.append((x + R * math.cos(t), max(bottom_z, wheel_r + R * math.sin(t))))
        pts.append((x + R, bottom_z))
    pts.append((x_front, bottom_z))
    out = []
    for p in pts + list(upper):
        if not out or abs(out[-1][0] - p[0]) > 1e-4 or abs(out[-1][1] - p[1]) > 1e-4:
            out.append(p)
    return out


def car(name, L, W, upper, cabin, wheel_r, wheel_x, lightbar=False, roof_rack=False, doors=2):
    """Passenger car. `upper` is the body outline front→rear above the sills;
    `cabin` = (front_bottom_x, rear_bottom_x, belt_z, front_top_x, rear_top_x, roof_z)."""
    b = Builder(name)
    hl = L / 2
    xs = (wheel_x, -wheel_x)
    bottom = wheel_r * 0.95
    # Body shell with wheel arches and rounded edges.
    b.prism(arched_profile(bottom, xs, wheel_r, upper), W, M("Body"), bevel=0.07, segments=2)
    # Dark underbody and wheel wells so the car never looks hollow.
    b.box((L - 0.5, W - 0.3, 0.16), (0, 0, bottom + 0.04), M("Trim"))
    for x in xs:
        b.box((wheel_r * 2.3, W - 0.42, 0.5), (x, 0, wheel_r + 0.1), M("Trim"))
    # Greenhouse: glass all round, painted roof.
    fbx, rbx, bz, ftx, rtx, rz = cabin
    bw = W / 2 - 0.08
    tw = W / 2 - 0.27
    b.frustum((rbx, fbx, bw, bz), (rtx, ftx, tw, rz), M("Body"), M("Glass"))
    b.box((ftx - rtx + 0.1, tw * 2 + 0.08, 0.06), ((ftx + rtx) / 2, 0, rz + 0.02), M("Body"))

    def side_strip(x0, x1, y_b, y_t, mat):
        """Quad lying on a cabin side between the belt and the roof (follows the taper)."""
        for side in (-1, 1):
            v = [b.bm.verts.new(c) for c in (
                (x0[0], side * y_b, bz), (x0[1], side * y_b, bz),
                (x1[1], side * y_t, rz), (x1[0], side * y_t, rz))]
            b._tag_faces([b.bm.faces.new(v)], mat)

    # A pillars (along the windshield edges), B pillar, and C pillar on 4-doors.
    k = 0.012
    side_strip((fbx - 0.16, fbx - 0.02), (ftx - 0.12, ftx), bw + k, tw + k, M("Body"))
    side_strip((rbx + 0.02, rbx + 0.2), (rtx, rtx + 0.16), bw + k, tw + k, M("Body"))
    mid = (fbx + rbx) / 2 + 0.1
    tmid = (ftx + rtx) / 2 + 0.1
    side_strip((mid - 0.06, mid + 0.06), (tmid - 0.06, tmid + 0.06), bw + k, tw + k, M("Trim"))
    # Belt-line trim.
    for side in (-1, 1):
        b.box((fbx - rbx, 0.03, 0.04), ((fbx + rbx) / 2, side * (W / 2 - 0.02), bz + 0.01), M("Trim"))
    # Door seams.
    seam_xs = [fbx - 0.12, mid] + ([rbx + 0.25] if doors > 2 else [])
    for x in seam_xs:
        for side in (-1, 1):
            b.box((0.025, 0.012, bz - bottom - 0.2), (x, side * (W / 2 + 0.003), (bz + bottom) / 2 + 0.05), M("Trim"))
    # Bumpers, grille, plates, lights, mirrors.
    front_z = upper[0][1]
    rear_z = upper[-1][1]
    b.box((0.18, W - 0.1, 0.2), (hl - 0.03, 0, bottom + 0.12), M("Trim"), bevel=0.05, segments=1)
    b.box((0.18, W - 0.1, 0.2), (-hl + 0.03, 0, bottom + 0.12), M("Trim"), bevel=0.05, segments=1)
    b.box((0.06, W * 0.42, 0.15), (hl + 0.02, 0, front_z - 0.12), M("Trim"))
    b.box((0.03, 0.48, 0.11), (hl + 0.07, 0, bottom + 0.14), M("White"))
    b.box((0.03, 0.48, 0.11), (-hl - 0.07, 0, rear_z - 0.2), M("White"))
    for side in (-1, 1):
        b.box((0.1, 0.38, 0.11), (hl - 0.03, side * (W / 2 - 0.27), front_z - 0.07), M("Headlight"))
        b.box((0.1, 0.44, 0.12), (-hl + 0.03, side * (W / 2 - 0.26), rear_z - 0.08), M("Taillight"))
        b.box((0.16, 0.2, 0.11), (fbx - 0.2, side * (W / 2 + 0.07), bz + 0.08), M("Body"))
    wheels(b, xs, W / 2 - 0.14, wheel_r)
    if lightbar:
        b.box((0.3, W * 0.66, 0.11), ((ftx + rtx) / 2, 0, rz + 0.11), M("Lightbar"))
    if roof_rack:
        for side in (-1, 1):
            b.box((ftx - rtx - 0.2, 0.05, 0.05), ((ftx + rtx) / 2, side * (tw - 0.06), rz + 0.09), M("Trim"))
    return b.finish(smooth_angle=40)


def build_vehicles():
    objs = []
    # upper: front bumper top → hood → windshield base → roof line is the cabin → trunk → rear.
    objs.append(car("sedan", 4.6, 1.82,
                    [(2.3, 0.62), (2.24, 0.78), (1.9, 0.86), (1.0, 0.94), (-1.6, 0.97), (-2.18, 0.93), (-2.3, 0.66)],
                    (1.0, -1.62, 0.94, 0.25, -1.05, 1.42), 0.33, 1.42, doors=4))
    objs.append(car("hatchback", 4.0, 1.76,
                    [(2.0, 0.62), (1.95, 0.8), (1.62, 0.88), (0.85, 0.96), (-1.95, 0.99), (-2.0, 0.66)],
                    (0.85, -1.88, 0.96, 0.12, -1.8, 1.5), 0.32, 1.28))
    objs.append(car("suv", 4.8, 1.96,
                    [(2.4, 0.82), (2.34, 1.0), (1.9, 1.08), (1.1, 1.12), (-2.3, 1.14), (-2.4, 0.86)],
                    (1.1, -2.28, 1.12, 0.36, -2.2, 1.82), 0.39, 1.52, roof_rack=True, doors=4))
    objs.append(car("police", 4.8, 1.84,
                    [(2.4, 0.62), (2.34, 0.78), (1.95, 0.87), (1.04, 0.95), (-1.66, 0.98), (-2.26, 0.94), (-2.4, 0.66)],
                    (1.04, -1.68, 0.95, 0.27, -1.1, 1.44), 0.34, 1.5, lightbar=True, doors=4))

    # Van: boxy delivery van with glass only up front.
    b = Builder("van")
    L, W = 5.2, 2.0
    b.box((L - 0.4, W - 0.2, 0.25), (0, 0, 0.28), M("Trim"))
    b.prism([(-2.6, 0.32), (2.6, 0.32), (2.6, 0.82), (2.42, 1.08), (1.55, 1.2), (1.0, 2.25), (-2.6, 2.25), (-2.6, 0.32)], W, M("Body"), bevel=0.07)
    for side in (-1, 1):
        b.box((0.9, 0.03, 0.55), (1.2, side * (W / 2 + 0.005), 1.55), M("Glass"))
        b.box((0.06, 0.36, 0.13), (2.6, side * (W / 2 - 0.3), 0.9), M("Headlight"))
        b.box((0.06, 0.2, 0.34), (-2.6, side * (W / 2 - 0.16), 1.0), M("Taillight"))
    b.prism([(1.6, 1.22), (1.09, 2.18), (1.03, 2.18), (1.54, 1.22)], W - 0.24, M("Glass"))
    b.box((0.06, W * 0.86, 0.18), (2.62, 0, 0.6), M("Trim"))
    wheels(b, (1.75, -1.75), W / 2 - 0.14, 0.36)
    objs.append(b.finish(smooth_angle=35))

    # Ambulance: van cab + box body with stripe and lightbar.
    b = Builder("ambulance")
    b.box((5.6, 1.95, 0.25), (0, 0, 0.3), M("Trim"))
    b.prism([(1.4, 0.35), (3.1, 0.35), (3.1, 0.85), (2.95, 1.1), (2.2, 1.2), (1.75, 2.15), (1.4, 2.15)], 2.0, M("Body"), bevel=0.06)
    b.box((4.4, 2.2, 2.35), (-0.8, 0, 1.6), M("Body"), bevel=0.06)
    b.box((4.42, 2.22, 0.22), (-0.8, 0, 1.25), M("Stripe"))
    b.prism([(2.26, 1.22), (1.82, 2.1), (1.76, 2.1), (2.2, 1.22)], 1.78, M("Glass"))
    for side in (-1, 1):
        b.box((0.6, 0.03, 0.5), (2.1, side * 1.005, 1.6), M("Glass"))
        b.box((0.06, 0.32, 0.12), (3.1, side * 0.7, 0.92), M("Headlight"))
        b.box((0.06, 0.2, 0.3), (-3.0, side * 0.95, 1.0), M("Taillight"))
    b.box((0.35, 1.5, 0.14), (2.0, 0, 2.2), M("Lightbar"))
    b.box((0.2, 2.0, 0.12), (-2.95, 0, 2.82), M("Lightbar"))
    wheels(b, (2.1, -2.0), 0.86, 0.38)
    objs.append(b.finish(smooth_angle=35))

    def truck_cab(b, x_front, W, cab_len=2.1, h=2.9, mat="Body"):
        x0 = x_front - cab_len
        b.prism([(x0, 0.75), (x_front, 0.75), (x_front, 1.5), (x_front - 0.08, 2.1), (x_front - 0.32, h), (x0, h)], W, M(mat), bevel=0.08)
        b.prism([(x_front - 0.06, 1.62), (x_front - 0.3, 2.78), (x_front - 0.36, 2.78), (x_front - 0.12, 1.62)], W - 0.3, M("Glass"))
        for side in (-1, 1):
            b.box((0.9, 0.03, 0.6), (x_front - 1.0, side * (W / 2 + 0.005), 2.1), M("Glass"))
            b.box((0.07, 0.36, 0.16), (x_front + 0.01, side * (W / 2 - 0.32), 1.05), M("Headlight"))
            b.box((0.12, 0.08, 0.35), (x_front - 0.25, side * (W / 2 + 0.12), 2.1), M("Trim"))
        b.box((0.1, W * 0.9, 0.3), (x_front + 0.03, 0, 0.75), M("Trim"))

    # Box truck
    b = Builder("truck")
    W = 2.45
    b.box((8.2, 1.1, 0.4), (0, 0, 0.75), M("DarkSteel"))
    truck_cab(b, 4.25, W)
    b.box((6.0, W + 0.05, 2.75), (-1.15, 0, 2.3), M("Body"), bevel=0.04)
    for side in (-1, 1):
        b.box((0.06, 0.25, 0.25), (-4.16, side * 1.05, 1.0), M("Taillight"))
    wheels(b, (3.2, -2.3, -3.5), W / 2 - 0.2, 0.5, width=0.3, dual_rear=True)
    objs.append(b.finish(smooth_angle=35))

    # Garbage truck
    b = Builder("garbage")
    W = 2.45
    b.box((7.8, 1.1, 0.4), (0, 0, 0.75), M("DarkSteel"))
    truck_cab(b, 4.0, W, mat="BodyAccent")
    b.box((4.6, W + 0.05, 2.5), (-0.6, 0, 2.15), M("Body"), bevel=0.35, segments=3)
    b.box((1.4, W + 0.1, 2.2), (-3.5, 0, 1.95), M("DarkSteel"), bevel=0.12)
    for side in (-1, 1):
        b.box((0.06, 0.22, 0.22), (-4.21, side * 1.05, 1.0), M("Taillight"))
    wheels(b, (3.0, -2.0, -3.2), W / 2 - 0.2, 0.5, width=0.3, dual_rear=True)
    objs.append(b.finish(smooth_angle=35))

    # Fire truck
    b = Builder("firetruck")
    W = 2.5
    b.box((8.6, 1.1, 0.4), (0, 0, 0.75), M("DarkSteel"))
    truck_cab(b, 4.5, W, cab_len=2.5, h=2.95)
    b.box((6.0, W + 0.02, 1.9), (-1.2, 0, 1.9), M("Body"), bevel=0.05)
    for k in range(4):
        for side in (-1, 1):
            b.box((1.2, 0.03, 1.2), (0.9 - k * 1.45, side * (W / 2 + 0.012), 1.85), M("Chrome"))
    b.box((7.5, 0.9, 0.18), (-0.6, 0, 2.95), M("Steel"))
    for side in (-1, 1):
        b.box((7.5, 0.06, 0.12), (-0.6, side * 0.42, 3.1), M("Chrome"))
    b.box((0.35, 1.8, 0.14), (2.2, 0, 3.02), M("Lightbar"))
    wheels(b, (3.4, -2.4, -3.6), W / 2 - 0.2, 0.5, width=0.3, dual_rear=True)
    objs.append(b.finish(smooth_angle=35))
    objs.append(city_bus())
    return objs


def city_bus():
    """12 m low-floor city bus. Body takes the line colour; roof and skirt stay neutral."""
    b = Builder("bus")
    L, W, H = 12.0, 2.55, 3.05
    hl = L / 2
    wr = 0.5
    xs = (hl - 2.7, -hl + 3.3)
    # Body shell with wheel arches and a gently raked front.
    upper = [(hl, 0.55), (hl + 0.05, 1.0), (hl - 0.05, H - 0.35), (hl - 0.3, H - 0.05), (-hl + 0.2, H - 0.05), (-hl, H - 0.3), (-hl, 0.55)]
    b.prism(arched_profile(0.38, xs, wr, upper, arch_gap=0.08), W, M("Body"), bevel=0.1, segments=2)
    # Neutral roof and roof-mounted equipment pod.
    b.box((L - 0.9, W - 0.3, 0.06), (-0.05, 0, H - 0.02), M("White"))
    b.box((3.2, W - 0.8, 0.32), (-1.6, 0, H + 0.12), M("White"), bevel=0.08, segments=1)
    # Window band along both sides, with mullions.
    for side in (-1, 1):
        y = side * (W / 2 + 0.006)
        b.box((L - 1.6, 0.03, 1.25), (-0.35, y, 1.95), M("Glass"))
        for k in range(7):
            b.box((0.09, 0.04, 1.25), (-hl + 1.1 + k * 1.55, y, 1.95), M("Trim"))
        # Black skirt.
        b.box((L - 0.4, 0.03, 0.32), (0, side * (W / 2 + 0.004), 0.56), M("Trim"))
        # Doors (front and middle) on both sides read well from any angle.
        for dx in (hl - 1.15, -0.4):
            b.box((1.2, 0.04, 2.1), (dx, side * (W / 2 + 0.01), 1.45), M("Glass"))
            b.box((0.05, 0.05, 2.1), (dx, side * (W / 2 + 0.02), 1.45), M("Trim"))
        b.box((0.16, 0.24, 0.2), (hl - 0.25, side * (W / 2 + 0.12), H - 0.55), M("Trim"))
    # Front: windshield, destination display, lights, bumper.
    b.box((0.04, W - 0.25, 1.55), (hl + 0.02, 0, 1.95), M("Glass"))
    b.box((0.05, W - 0.6, 0.28), (hl + 0.04, 0, H - 0.28), M("Lamp"))
    b.box((0.04, W - 0.3, 0.06), (-hl - 0.02, 0, H - 0.3), M("Trim"))
    b.box((0.05, 0.3, 0.14), (-hl - 0.03, 0.0, 1.05), M("White"))
    for side in (-1, 1):
        b.box((0.08, 0.36, 0.16), (hl + 0.03, side * (W / 2 - 0.3), 0.85), M("Headlight"))
        b.box((0.08, 0.2, 0.5), (-hl - 0.03, side * (W / 2 - 0.2), 1.1), M("Taillight"))
    b.box((0.22, W, 0.3), (hl + 0.04, 0, 0.45), M("Trim"), bevel=0.05, segments=1)
    b.box((0.22, W, 0.3), (-hl - 0.04, 0, 0.45), M("Trim"), bevel=0.05, segments=1)
    b.box((L - 1.0, W - 0.3, 0.2), (0, 0, 0.42), M("Trim"))
    for x in xs:
        b.box((wr * 2.4, W - 0.5, 0.6), (x, 0, wr + 0.15), M("Trim"))
    wheels(b, xs, W / 2 - 0.2, wr, width=0.3)
    return b.finish(smooth_angle=40)


# ── Aircraft ────────────────────────────────────────────────────────────────

def airliner():
    """Regional jet, about 35 m long (forward = +X, origin under the fuselage at gear height).
    The fuselage is white; tail, engine nacelles and cheat line take the airline colour."""
    b = Builder("airliner")
    L, R = 32.0, 1.75
    hl = L / 2
    zc = 3.0
    # Fuselage, rounded nose and an upswept tail cone.
    b.cylinder(R, R, L - 9.0, (0.5, 0, zc), M("White"), segments=16, axis="X")
    b.sphere(R, (hl - 4.0, 0, zc - 0.05), M("White"), subdiv=2, scale=(2.2, 1.0, 0.98))
    tail = b.cylinder(0.35, R, 7.0, (-hl + 1.5, 0, zc), M("White"), segments=16, axis="X")
    for f in tail:
        for v in f.verts:
            if v.co.x < -hl + 4.5:
                v.co.z += (-hl + 4.5 - v.co.x) * 0.2
    # Cockpit glass and passenger windows.
    for side in (-1, 1):
        b.box((1.3, 0.5, 0.42), (hl - 2.3, side * 0.9, zc + 0.75), M("Glass"), rot_z=side * -0.5)
        b.box((L - 13.0, 0.05, 0.34), (0.3, side * (R - 0.02), zc + 0.55), M("Glass"))
        # Cheat line in the airline colour.
        b.box((L - 11.0, 0.05, 0.16), (0.0, side * (R - 0.01), zc - 0.05), M("Body"))

    def slab(points, z0, thickness, mat):
        """Flat planform (list of (x, y)) extruded upward by thickness."""
        bm = b.bm
        lo = [bm.verts.new((x, y, z0)) for x, y in points]
        hi = [bm.verts.new((x, y, z0 + thickness)) for x, y in points]
        faces = [bm.faces.new(list(reversed(lo))), bm.faces.new(hi)]
        n = len(points)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
        b._tag_faces(set(faces), mat)

    # Swept wings with a slight dihedral, and the tailplane.
    for side in (-1, 1):
        slab([(2.6, side * 1.2), (-2.4, side * 1.2), (-6.2, side * 14.5), (-4.6, side * 14.5)], zc - 1.1, 0.35, M("White"))
        slab([(-4.6, side * 14.5), (-6.2, side * 14.5), (-6.6, side * 15.2), (-5.4, side * 15.2)], zc - 1.0, 0.25, M("Body"))
        slab([(-hl + 3.6, side * 0.6), (-hl + 1.2, side * 0.6), (-hl - 0.6, side * 5.6), (-hl + 0.6, side * 5.6)], zc + 0.95, 0.22, M("White"))
        # Engine nacelles under the wings, with dark intakes.
        b.cylinder(0.85, 0.7, 3.6, (0.4, side * 5.2, zc - 1.75), M("Body"), segments=14, axis="X")
        b.cylinder(0.72, 0.72, 0.08, (2.24, side * 5.2, zc - 1.75), M("Trim"), segments=14, axis="X")
        b.box((1.6, 0.2, 0.7), (0.0, side * 5.2, zc - 1.15), M("White"))
        # Landing light in the wing root, navigation light at the tip.
        b.box((0.3, 0.3, 0.2), (2.3, side * 1.6, zc - 0.95), M("Headlight"))
        b.box((0.4, 0.2, 0.18), (-5.6, side * 15.25, zc - 0.9), M("Headlight" if side > 0 else "Taillight"))
    # Fin in the airline colour.
    fin = [(-hl + 5.2, zc + 1.4), (-hl + 0.6, zc + 1.4), (-hl - 1.6, zc + 7.6), (-hl + 0.4, zc + 7.6)]
    b.prism(fin, 0.32, M("Body"))
    # Landing gear.
    b.box((0.25, 0.25, 1.6), (hl - 5.0, 0, 0.9), M("DarkSteel"))
    b.cylinder(0.45, 0.45, 0.3, (hl - 5.0, 0, 0.45), M("Tire"), segments=10, axis="Y")
    for side in (-1, 1):
        b.box((0.3, 0.3, 1.5), (-2.0, side * 2.6, 0.95), M("DarkSteel"))
        b.cylinder(0.55, 0.55, 0.5, (-2.0, side * 2.6, 0.55), M("Tire"), segments=10, axis="Y")
    return b.finish(smooth_angle=35)


# ── Boats ───────────────────────────────────────────────────────────────────

def hull(b, L, W, H, deck_mat, hull_mat):
    """Pointed-bow hull (forward = +X) from a stack of planform rings."""
    bm = b.bm
    rings = []
    for z, scale in ((0.0, 0.62), (H * 0.55, 0.92), (H, 1.0)):
        hl, hw = L / 2 * (0.86 + 0.14 * scale), W / 2 * scale
        pts = [(hl, 0), (hl * 0.55, hw), (-hl * 0.6, hw), (-hl, hw * 0.82), (-hl, -hw * 0.82), (-hl * 0.6, -hw), (hl * 0.55, -hw)]
        rings.append([bm.verts.new((x, y, z)) for x, y in pts])
    faces = []
    for a, c in zip(rings, rings[1:]):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], c[j], c[i])))
    b._tag_faces(set(faces), hull_mat)
    b._tag_faces({bm.faces.new(list(reversed(rings[0])))}, hull_mat)
    b._tag_faces({bm.faces.new(rings[-1])}, deck_mat)


def sailboat():
    """9 m sloop: white hull with a coloured stripe, mast, mainsail and jib."""
    b = Builder("sailboat")
    hull(b, 9.0, 2.8, 1.0, M("Wood"), M("White"))
    b.box((4.9, 2.6, 0.14), (-0.1, 0, 0.62), M("Body"))
    b.box((2.4, 1.6, 0.5), (-1.0, 0, 1.25), M("White"), bevel=0.08, segments=1)
    b.box((0.8, 1.5, 0.12), (-0.2, 0, 1.4), M("Glass"))
    b.cylinder(0.08, 0.06, 11.0, (0.6, 0, 6.5), M("Steel"), segments=6)
    b.cylinder(0.05, 0.05, 4.2, (-1.5, 0, 1.9), M("Steel"), segments=6, axis="X")
    sail = [(0.55, 1.95), (-3.55, 1.95), (0.55, 11.6)]
    b.prism(sail, 0.04, M("Sail"))
    jib = [(0.7, 1.4), (4.1, 1.15), (0.7, 10.6)]
    b.prism(jib, 0.04, M("Sail"))
    return b.finish(smooth_angle=30)


def motorboat():
    """7 m day cruiser with a windscreen and a canopy."""
    b = Builder("motorboat")
    hull(b, 7.0, 2.5, 0.95, M("Wood"), M("White"))
    b.box((3.8, 2.34, 0.16), (-0.1, 0, 0.6), M("Body"))
    b.box((0.1, 1.9, 0.5), (0.6, 0, 1.2), M("Glass"), rot_z=0.0)
    b.box((1.6, 2.0, 0.08), (-1.2, 0, 2.0), M("Body"))
    for y in (-0.85, 0.85):
        b.box((0.06, 0.06, 1.0), (-0.5, y, 1.5), M("Steel"))
        b.box((0.06, 0.06, 1.0), (-1.9, y, 1.5), M("Steel"))
    b.box((0.5, 0.4, 0.7), (-3.35, 0, 0.55), M("DarkSteel"))
    return b.finish(smooth_angle=30)


def container_ship():
    """Feeder container ship, about 120 m (forward = +X). The origin sits at the keel;
    the game lowers it so the waterline falls about 5 m up the hull. The hull takes
    the line's colour; containers are stacked in bays forward of the stern bridge."""
    b = Builder("container_ship")
    rng = random.Random(7)
    L, W, H = 118.0, 19.0, 11.0
    hull(b, L, W, H, M("DarkSteel"), M("Body"))
    # Red antifouling below the waterline and a white sheer line along the deck edge.
    hull(b, L - 1.0, W - 0.4, 4.6, M("Antifoul"), M("Antifoul"))
    for side in (-1, 1):
        b.box((L * 0.62, 0.12, 0.5), (-4.0, side * (W / 2 - 0.02), H - 0.6), M("White"))
    # Forecastle with a mast and a stern deckhouse with bridge wings and a funnel.
    b.box((9.0, 15.0, 2.4), (L / 2 - 12.0, 0, H + 1.2), M("White"))
    b.cylinder(0.35, 0.25, 9.0, (L / 2 - 10.0, 0, H + 6.5), M("Steel"), segments=6)
    sx = -L / 2 + 14.0
    b.box((11.0, 16.0, 13.0), (sx, 0, H + 6.5), M("White"))
    b.box((4.0, 23.0, 0.6), (sx + 3.4, 0, H + 13.2), M("White"))
    b.box((0.3, 15.0, 1.6), (sx + 5.6, 0, H + 11.4), M("Glass"))
    for y in (-5.0, 0.0, 5.0):
        for z in (H + 3.0, H + 6.0, H + 9.0):
            b.box((0.2, 3.0, 1.0), (sx + 5.52, y, z), M("Glass"))
    b.box((4.0, 4.6, 7.0), (sx - 3.0, 0, H + 16.0), M("DarkSteel"))
    b.box((4.1, 4.7, 1.2), (sx - 3.0, 0, H + 18.6), M("Body"))
    b.cylinder(0.2, 0.15, 6.0, (sx + 1.0, 0, H + 16.0), M("Steel"), segments=6)
    # Container bays: 40 ft boxes, eight across, stacked two to five high.
    colors = ["BoxRed", "BoxBlue", "BoxGreen", "BoxOrange", "BoxGrey", "BoxTeal", "White"]
    bay_len, box_w, box_h = 12.2, 2.3, 2.6
    x = sx + 9.0
    while x + bay_len < L / 2 - 17.0:
        cx = x + bay_len / 2
        for row in range(8):
            y = (row - 3.5) * (box_w + 0.08)
            n = rng.choice([2, 3, 3, 4, 4, 5]) if row not in (0, 7) else rng.choice([2, 3])
            for k in range(n):
                b.box((bay_len - 0.3, box_w, box_h - 0.06), (cx, y, H + 0.1 + box_h * (k + 0.5)), M(rng.choice(colors)))
        x += bay_len + 0.6
    return b.finish(smooth_angle=30)


# ── Vegetation ──────────────────────────────────────────────────────────────

# Leaf atlas layout (texture generated in-game): tiles (0,0), (1,0), (0,1) hold
# leaf clusters with alpha; tile (1,1) is solid white for bark and blobs.
LEAF_TILES = [(0.0, 0.0), (0.5, 0.0), (0.0, 0.5)]
SOLID_UV = (0.75, 0.75)


def random_in_sphere():
    while True:
        p = Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1)))
        if p.length <= 1:
            return p


class FoliageBuilder(Builder):
    """Builder that also records crown centres for soft, outward foliage normals."""

    def __init__(self, name):
        super().__init__(name)
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.crowns = []  # (center, faces)

    def solid_uvs(self, faces):
        for f in faces:
            for loop in f.loops:
                loop[self.uv].uv = SOLID_UV

    def cards(self, center, radii, count, mats, size=(1.4, 2.2)):
        """Scatters crossed leaf cards inside an ellipsoid."""
        bm = self.bm
        c = Vector(center)
        made = []
        for i in range(count):
            p = random_in_sphere()
            p = Vector((p.x * radii[0], p.y * radii[1], p.z * radii[2]))
            pos = c + p * (0.35 + 0.65 * random.random())
            out = (pos - c).normalized() if (pos - c).length > 1e-3 else Vector((0, 0, 1))
            n = (out * 0.55 + random_in_sphere() * 0.45).normalized()
            t = n.cross(Vector((0, 0, 1)))
            if t.length < 1e-3:
                t = Vector((1, 0, 0))
            t.normalize()
            bt = n.cross(t).normalized()
            s = random.uniform(*size)
            corners = [pos - t * s / 2 - bt * s / 2, pos + t * s / 2 - bt * s / 2, pos + t * s / 2 + bt * s / 2, pos - t * s / 2 + bt * s / 2]
            verts = [bm.verts.new(v) for v in corners]
            f = bm.faces.new(verts)
            u0, v0 = random.choice(LEAF_TILES)
            for loop, (du, dv) in zip(f.loops, ((0, 0), (0.5, 0), (0.5, 0.5), (0, 0.5))):
                loop[self.uv].uv = (u0 + du * 0.98 + 0.005, v0 + dv * 0.98 + 0.005)
            mat = mats[0] if pos.z > c.z + radii[2] * 0.25 else mats[2] if pos.z < c.z - radii[2] * 0.3 else mats[1]
            f.material_index = self.mat_index(M(mat))
            f.smooth = True
            made.append(f)
        self.crowns.append((c, made))
        return made

    def finish_foliage(self):
        for f in self.bm.faces:
            if all(l[self.uv].uv.length == 0 for l in f.loops):
                for l in f.loops:
                    l[self.uv].uv = SOLID_UV
        # Assign outward normals per loop for leaf cards.
        self.bm.faces.index_update()
        face_center = {}
        for c, faces in self.crowns:
            for f in faces:
                face_center[f.index] = c
        obj = self.finish()
        mesh = obj.data
        try:
            normals = [cn.vector.copy() for cn in mesh.corner_normals]
            for poly in mesh.polygons:
                c = face_center.get(poly.index)
                if c is None:
                    continue
                for li in poly.loop_indices:
                    v = mesh.vertices[mesh.loops[li].vertex_index].co
                    d = (v - c)
                    d.z *= 1.3
                    normals[li] = (d.normalized() * 0.8 + Vector((0, 0, 0.2))).normalized()
            mesh.normals_split_custom_set(normals)
        except Exception as e:  # pragma: no cover - older Blender APIs
            print("custom normals unavailable:", e)
        return obj


def broadleaf(name, clumps, leaf, leaf_dark, leaf_light, height, spread, trunk_h, trunk_r, cards_per_clump=14):
    b = FoliageBuilder(name)
    b.solid_uvs(b.cylinder(trunk_r, trunk_r * 0.55, trunk_h + 1.4, (0, 0, (trunk_h + 1.4) / 2), M("Bark"), segments=7))
    for k in range(4):
        a = k * 1.7 + 0.4
        tilt = Matrix.Rotation(0.7, 4, Vector((-math.sin(a), math.cos(a), 0)))
        faces = b.cylinder(trunk_r * 0.4, trunk_r * 0.15, 2.4, (0, 0, 0), M("Bark"), segments=5)
        for v in {v for f in faces for v in f.verts}:
            v.co = tilt @ (v.co + Vector((0, 0, 1.2))) + Vector((0, 0, trunk_h + 0.3))
        b.solid_uvs(faces)
    crown_h = height - trunk_h
    # Dense dark core keeps the crown from looking see-through.
    b.solid_uvs(b.sphere(spread * 0.72, (0, 0, trunk_h + crown_h * 0.5), M(leaf_dark), subdiv=1, scale=(1, 1, 0.78), jitter=0.12))
    for i in range(clumps):
        a = i / clumps * math.pi * 2 + random.uniform(-0.35, 0.35)
        ring = spread * random.uniform(0.3, 0.68)
        z = trunk_h + crown_h * random.uniform(0.3, 0.78)
        r = spread * random.uniform(0.42, 0.6)
        b.cards((math.cos(a) * ring, math.sin(a) * ring, z), (r, r, r * 0.8), cards_per_clump, (leaf_light, leaf, leaf_dark))
    b.cards((0, 0, height - spread * 0.5), (spread * 0.55, spread * 0.55, spread * 0.42), cards_per_clump, (leaf_light, leaf_light, leaf))
    return b.finish_foliage()


def pine(name):
    b = Builder(name)
    b.cylinder(0.24, 0.12, 3.0, (0, 0, 1.5), M("Bark"), segments=6)
    tiers = [(2.3, 1.6, 3.2), (1.9, 3.1, 3.0), (1.45, 4.5, 2.7), (1.0, 5.9, 2.4), (0.55, 7.2, 1.9)]
    for i, (r, z, h) in enumerate(tiers):
        mat = "PineNeedleLight" if i >= 3 else "PineNeedle"
        faces = b.cylinder(r, 0.05, h, (0, 0, z + h / 2), M(mat), segments=9, smooth=True)
        for v in {v for f in faces for v in f.verts}:
            if v.co.z < z + 0.2:
                v.co.x += random.uniform(-0.12, 0.12)
                v.co.y += random.uniform(-0.12, 0.12)
                v.co.z += random.uniform(-0.25, 0.05)
    return b.finish()


def bush(name):
    b = FoliageBuilder(name)
    b.solid_uvs(b.sphere(0.75, (0, 0, 0.55), M("LeafDark"), subdiv=1, scale=(1.2, 1.2, 0.7), jitter=0.12))
    for i in range(3):
        a = i * 2.1
        b.cards((math.cos(a) * 0.4, math.sin(a) * 0.4, 0.7), (0.75, 0.75, 0.55), 7, ("LeafLight", "BushLeaf", "Leaf"), size=(0.8, 1.2))
    return b.finish_foliage()


def tree_lod(name, pine_shape=False):
    b = Builder(name)
    if pine_shape:
        b.cylinder(0.22, 0.15, 1.8, (0, 0, 0.9), M("Bark"), segments=5)
        b.cylinder(2.1, 0.08, 7.6, (0, 0, 1.4 + 3.8), M("PineNeedle"), segments=7)
    else:
        b.cylinder(0.25, 0.18, 3.2, (0, 0, 1.6), M("Bark"), segments=5)
        b.sphere(2.6, (0, 0, 5.6), M("Leaf"), subdiv=1, scale=(1, 1, 0.85), jitter=0.08)
    return b.finish()


# ── Street furniture & site props ───────────────────────────────────────────

def bus_stop():
    """Bus shelter. Open side faces -Y (towards the road); origin at ground centre."""
    b = Builder("bus_stop")
    w, d, h = 3.8, 1.5, 2.45
    # Slab, roof and frame.
    b.box((w + 0.6, d + 0.5, 0.12), (0, 0, 0.06), M("Concrete"))
    b.box((w + 0.25, d + 0.35, 0.1), (0, 0.05, h), M("Steel"), bevel=0.03, segments=1)
    for x in (-w / 2, w / 2):
        for y in (d / 2 - 0.05,):
            b.box((0.08, 0.08, h), (x, y, h / 2 + 0.06), M("DarkSteel"))
        b.box((0.08, 0.08, h), (x, -d / 2 + 0.25, h / 2 + 0.06), M("DarkSteel"))
    # Glass back wall and one side panel with an advertising board.
    b.box((w, 0.04, h - 0.45), (0, d / 2 - 0.05, h / 2 + 0.1), M("Glass"))
    b.box((0.04, d - 0.35, h - 0.45), (-w / 2, 0.1, h / 2 + 0.1), M("Glass"))
    b.box((0.06, d - 0.5, 1.6), (w / 2, 0.12, 1.25), M("Lamp"))
    # Bench.
    b.box((w - 0.8, 0.42, 0.06), (0, d / 2 - 0.35, 0.48), M("Trim"))
    for x in (-w / 2 + 0.6, w / 2 - 0.6):
        b.box((0.06, 0.38, 0.42), (x, d / 2 - 0.35, 0.27), M("DarkSteel"))
    # Stop sign on a pole at the curb.
    b.cylinder(0.05, 0.05, 2.9, (w / 2 + 0.8, -d / 2 - 0.2, 1.45 + 0.06), M("DarkSteel"), segments=8)
    b.box((0.06, 0.55, 0.55), (w / 2 + 0.8, -d / 2 - 0.2, 2.75), M("SignBlue"))
    return b.finish(smooth_angle=30)


def streetlight():
    b = Builder("streetlight")
    b.cylinder(0.16, 0.16, 0.5, (0, 0, 0.25), M("DarkSteel"), segments=8)
    b.cylinder(0.09, 0.065, 8.2, (0, 0, 4.1), M("DarkSteel"), segments=8)
    b.box((1.9, 0.07, 0.07), (0.9, 0, 8.0), M("DarkSteel"), rot_z=0)
    b.box((0.75, 0.3, 0.14), (1.95, 0, 7.95), M("DarkSteel"), bevel=0.04)
    b.box((0.6, 0.22, 0.03), (1.95, 0, 7.865), M("Lamp"))
    return b.finish(smooth_angle=40)


def traffic_signal():
    b = Builder("signal")
    b.cylinder(0.14, 0.12, 6.0, (0, 0, 3.0), M("DarkSteel"), segments=8)
    b.box((4.2, 0.1, 0.1), (2.1, 0, 5.85), M("DarkSteel"))
    b.box((0.32, 0.3, 0.95), (3.9, 0, 5.3), M("Trim"), bevel=0.03)
    b.box((0.3, 0.28, 0.75), (0, 0.2, 3.2), M("Trim"), bevel=0.03)
    return b.finish(smooth_angle=40)


def crane():
    b = Builder("crane")
    H = 42.0
    # Mast: lattice approximated by four chords plus diagonal panels.
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box((0.18, 0.18, H), (sx * 0.8, sy * 0.8, H / 2), M("Yellow"))
    for k in range(int(H / 3)):
        z = 1.5 + k * 3
        for (dx, dy, rz) in ((0, -0.8, 0), (0, 0.8, 0), (-0.8, 0, math.pi / 2), (0.8, 0, math.pi / 2)):
            b.box((1.6, 0.08, 0.08), (dx, dy, z), M("Yellow"), rot_z=rz)
    b.box((2.6, 2.6, 1.2), (0, 0, 0.6), M("Concrete"))
    b.box((2.0, 2.0, 1.6), (0.6, 0, H + 0.8), M("Yellow"))
    b.box((1.6, 1.4, 1.4), (1.6, 1.4, H + 0.2), M("White"), bevel=0.05)
    b.box((1.8, 1.4, 1.1), (1.6, 1.42, H + 0.2), M("Glass"))
    # Jib and counter-jib.
    b.box((34.0, 0.9, 0.9), (17.0 + 1.0, 0, H + 1.8), M("Yellow"))
    b.box((10.0, 1.2, 0.8), (-5.0, 0, H + 1.8), M("Yellow"))
    b.box((2.4, 2.2, 1.8), (-8.4, 0, H + 1.0), M("Concrete"))
    b.box((0.25, 0.25, 6.0), (0.6, 0, H + 4.5), M("Yellow"))
    b.box((1.0, 0.6, 0.5), (22.0, 0, H + 1.0), M("DarkSteel"))
    b.cylinder(0.03, 0.03, 18.0, (22.0, 0, H - 8.5), M("DarkSteel"), segments=4)
    b.box((0.7, 0.7, 0.4), (22.0, 0, H - 17.6), M("Yellow"))
    return b.finish(smooth_angle=40)


def wind_tower():
    b = Builder("wind_tower")
    b.cylinder(2.2, 2.2, 0.6, (0, 0, 0.3), M("Concrete"), segments=12)
    b.cylinder(1.6, 0.9, 48.0, (0, 0, 24.0), M("White"), segments=14)
    b.box((5.0, 2.1, 2.2), (-0.6, 0, 48.8), M("White"), bevel=0.4, segments=3)
    return b.finish(smooth_angle=50)


def wind_rotor():
    """Rotor centred on its hub at the origin; spins about +X."""
    b = Builder("wind_rotor")
    b.sphere(0.9, (0.4, 0, 0), M("White"), subdiv=2, scale=(1.4, 1, 1))
    for k in range(3):
        a = k * 2 * math.pi / 3
        bm = b.bm
        L = 27.0
        prof = [(0.0, -0.9), (0.0, 0.9), (L * 0.25, 0.75), (L, 0.18), (L, -0.12), (L * 0.25, -0.55)]
        verts_a = [bm.verts.new((0.1, x * 0 + y * 0.08, 0)) for x, y in prof]
        verts_b = [bm.verts.new((-0.1, 0, 0)) for _ in prof]
        for i, (r, w) in enumerate(prof):
            ca, sa = math.cos(a), math.sin(a)
            verts_a[i].co = Vector((0.12, ca * w - sa * r, sa * w + ca * r))
            verts_b[i].co = Vector((-0.12, ca * w * 0.9 - sa * r, sa * w * 0.9 + ca * r))
        n = len(prof)
        bm.faces.new(verts_a)
        bm.faces.new(list(reversed(verts_b)))
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((verts_a[j], verts_a[i], verts_b[i], verts_b[j]))
        b._tag(verts_a + verts_b, M("White"))
    return b.finish(smooth_angle=50)


def export(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT_DIR, obj.name + ".glb")
    kwargs = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_materials="EXPORT")
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"exported {obj.name:12s} {tris:6d} tris -> {path}")
    return tris


def render_closeup(objs, path, spacing=6.2, distance=17.0):
    """Three-quarter close-up of the passenger vehicles (detail check)."""
    scene = bpy.context.scene
    x = 0.0
    hidden = [o for o in bpy.data.objects if o not in objs]
    for o in hidden:
        o.hide_render = True
    for o in objs:
        o.location = (x, 0, 0)
        o.rotation_euler = (0, 0, math.radians(-35))
        x += spacing
    cam_data = bpy.data.cameras.new("closeup")
    cam = bpy.data.objects.new("closeup", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (x / 2 - spacing / 2, -distance, 6.0 * distance / 17.0)
    cam.rotation_euler = (math.radians(73), 0, 0)
    cam_data.lens = 21
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_shadows = True
    shading.show_cavity = True
    scene.render.resolution_x = 2000
    scene.render.resolution_y = 700
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in objs:
        o.rotation_euler = (0, 0, 0)
    for o in hidden:
        o.hide_render = False
    bpy.data.objects.remove(cam, do_unlink=True)
    print("closeup ->", path)


def render_preview(objs, path):
    scene = bpy.context.scene
    big = {"crane", "wind_tower", "wind_rotor", "airliner"}
    # Two rows: vehicles in front, vegetation/props behind; tall structures at the back.
    rows = {0: 0.0, 1: 0.0, 2: 0.0}
    for o in objs:
        dims = o.dimensions
        row = 2 if o.name in big else 0 if o.name in ("sedan", "hatchback", "suv", "police", "van", "ambulance", "truck", "garbage", "firetruck") else 1
        o.location = (rows[row] + dims.x / 2, row * 14.0 + (60 if row == 2 else 0), 0)
        if o.name == "wind_rotor":
            o.location = (rows[2] - 8, 60, 48.8)
        else:
            rows[row] += dims.x + (2.0 if row == 0 else 2.5)
    width = max(rows[0], rows[1])
    bpy.ops.mesh.primitive_plane_add(size=1, location=(width / 2, 30, 0))
    ground = bpy.context.active_object
    ground.scale = (width + 120, 200, 1)
    gm = bpy.data.materials.new("Ground")
    gm.diffuse_color = (0.33, 0.38, 0.28, 1)
    ground.data.materials.append(gm)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (width / 2, -width * 0.62, width * 0.42)
    cam.rotation_euler = (math.radians(60), 0, 0)
    cam_data.lens = 32
    scene.camera = cam
    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(30))
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_shadows = True
    shading.show_cavity = True
    scene.render.resolution_x = 2400
    scene.render.resolution_y = 900
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("preview ->", path)


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    objs = []
    objs += build_vehicles()
    objs.append(broadleaf("oak", 7, "Leaf", "LeafDark", "LeafLight", 8.2, 2.5, 3.0, 0.3))
    objs.append(broadleaf("maple", 8, "MapleLeaf", "LeafDark", "MapleLeafLight", 9.4, 2.2, 3.4, 0.27))
    objs.append(pine("pine"))
    objs.append(bush("bush"))
    objs.append(tree_lod("tree_lod"))
    objs.append(tree_lod("pine_lod", pine_shape=True))
    objs.append(bus_stop())
    objs.append(streetlight())
    objs.append(traffic_signal())
    objs.append(crane())
    objs.append(wind_tower())
    objs.append(wind_rotor())
    objs.append(airliner())
    objs.append(sailboat())
    objs.append(motorboat())
    objs.append(container_ship())
    total = 0
    for o in objs:
        total += export(o)
    print(f"{len(objs)} assets, {total} triangles total")
    if PREVIEW:
        render_closeup([o for o in objs if o.name in ("sedan", "hatchback", "suv", "bus", "bus_stop")], PREVIEW.replace(".png", "_cars.png"))
        render_closeup([o for o in objs if o.name == "airliner"], PREVIEW.replace(".png", "_plane.png"), spacing=0, distance=46.0)
        render_closeup([o for o in objs if o.name in ("sailboat", "motorboat")], PREVIEW.replace(".png", "_boats.png"), spacing=12.0, distance=24.0)
        render_closeup([o for o in objs if o.name == "container_ship"], PREVIEW.replace(".png", "_ship.png"), spacing=0, distance=150.0)
        render_preview(objs, PREVIEW)


main()
