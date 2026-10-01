"""Fixed game-prep for a generated GLB: reduce triangles, keep UVs and textures, re-export. Never executes model-generated code."""
import bpy
import json
import sys
from pathlib import Path

request = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
if request['mode'] not in ('prep', 'measure'):
    raise RuntimeError('Unsupported operation.')

def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

def meshes():
    return sorted((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: o.name)

def triangles(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)

def bounds():
    bpy.context.view_layer.update()
    low, high = [1e18] * 3, [-1e18] * 3
    for obj in meshes():
        for corner in obj.bound_box:
            point = obj.matrix_world @ __import__('mathutils').Vector(corner)
            for i in range(3):
                low[i], high[i] = min(low[i], point[i]), max(high[i], point[i])
    return [round(high[i] - low[i], 4) for i in range(3)]

def measure():
    objs = meshes()
    return dict(objects=len(objs), triangles=sum(triangles(o) for o in objs), uvLayers=min((len(o.data.uv_layers) for o in objs), default=0),
                materials=sum(len([m for m in o.data.materials if m]) for o in objs), images=len([i for i in bpy.data.images if i.size[0] > 0]),
                size=bounds())

clear()
bpy.ops.import_scene.gltf(filepath=request['inputPath'])
if not meshes():
    raise RuntimeError('No mesh objects found in this model.')
before = measure()
result = dict(ok=True, mode=request['mode'], before=before, notes=[])
if request['mode'] == 'prep':
    target = int(request['targetTriangles'])
    if before['triangles'] <= target:
        result['notes'].append('Already at or under the triangle target; geometry left as it was.')
    else:
        # Spread the budget over the objects in proportion to their size so small parts are not erased.
        for obj in meshes():
            ratio = max(0.001, min(1.0, target * triangles(obj) / before['triangles'] / triangles(obj)))
            mod = obj.modifiers.new('GamePrepDecimate', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'; mod.ratio = ratio; mod.use_collapse_triangulate = True
            bpy.ops.object.select_all(action='DESELECT')
            bpy.context.view_layer.objects.active = obj; obj.select_set(True)
            bpy.ops.object.modifier_apply(modifier=mod.name)
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
    result['after'] = measure()
    out = Path(request['outputPath']); out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', export_apply=False)
else:
    result['after'] = before
Path(request['resultPath']).write_text(json.dumps(result, indent=2), encoding='utf-8')
