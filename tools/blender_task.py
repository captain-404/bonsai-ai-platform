"""Fixed, isolated mesh operations. Never executes model-generated code."""
import bpy
import bmesh
import json
import sys
from pathlib import Path

request = json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf-8'))
working = Path(request['workingPath']).resolve()
if Path(bpy.data.filepath).resolve() != working:
    raise RuntimeError('Wrong working copy; refusing to operate.')
if request['action'] not in ('inspect', 'cleanup'):
    raise RuntimeError('Unsupported operation.')

def measure():
    result = []
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        result.append(dict(name=obj.name, vertices=len(mesh.vertices), edges=len(mesh.edges),
                           polygons=len(mesh.polygons), triangles=len(mesh.loop_triangles),
                           looseVertices=sum(not v.link_edges for v in bm.verts),
                           looseEdges=sum(not e.link_faces for e in bm.edges),
                           boundaryEdges=sum(e.is_boundary for e in bm.edges),
                           nonManifoldEdges=sum(not e.is_manifold for e in bm.edges),
                           uvLayers=len(mesh.uv_layers), materials=[m.name if m else None for m in mesh.materials],
                           shapeKeys=bool(mesh.shape_keys), vertexGroups=len(obj.vertex_groups)))
        bm.free()
    return result

before = measure()
if not before:
    raise RuntimeError('No mesh objects found in this model.')
changed = False
notes = []
seen = set()
if request['action'] == 'cleanup':
    for obj in bpy.data.objects:
        if obj.type != 'MESH' or obj.data.as_pointer() in seen:
            continue
        mesh = obj.data
        seen.add(mesh.as_pointer())
        # Meshes shared with other objects, linked assets and deformation-sensitive assets are deliberately skipped.
        if mesh.users > 1 or mesh.library or obj.library or mesh.shape_keys or obj.vertex_groups or obj.modifiers:
            notes.append(f'{obj.name}: skipped because of sharing, linking, rigging, shape keys or modifiers.')
            continue
        bm = bmesh.new()
        bm.from_mesh(mesh)
        loose_edges = [e for e in bm.edges if not e.link_faces]
        if loose_edges:
            bmesh.ops.delete(bm, geom=loose_edges, context='EDGES')
        loose_vertices = [v for v in bm.verts if not v.link_edges]
        if loose_vertices:
            bmesh.ops.delete(bm, geom=loose_vertices, context='VERTS')
        if loose_edges or loose_vertices:
            bm.to_mesh(mesh)
            mesh.update()
            changed = True
            notes.append(f'{obj.name}: removed loose geometry only.')
        bm.free()
after = measure()
if changed:
    for old, new in zip(before, after):
        if old['polygons'] != new['polygons'] or old['triangles'] != new['triangles'] or old['materials'] != new['materials'] or old['uvLayers'] != new['uvLayers']:
            raise RuntimeError('Surface preservation check failed; copy will not be saved.')
    bpy.ops.wm.save_as_mainfile(filepath=str(working), check_existing=False)
else:
    notes.append('No changes made. This operation does not decimate, retopologize, rig or export.')
Path(request['resultPath']).write_text(json.dumps(dict(ok=True, workingPath=str(working), before=before, after=after, changed=changed, notes=notes), indent=2), encoding='utf-8')
