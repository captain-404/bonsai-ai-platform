import bpy
import sys
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
mesh = bpy.data.meshes.new('FixtureMesh')
mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0), (5, 5, 5)], [], [(0, 1, 2)])
mesh.update()
obj = bpy.data.objects.new('TriangleWithLooseVertex', mesh)
bpy.context.collection.objects.link(obj)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[sys.argv.index('--') + 1])
