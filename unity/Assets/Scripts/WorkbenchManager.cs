using UnityEngine;

namespace ForgeVerse
{
    /// <summary>工作台总控：模式切换 + 物件生成。对应网页版 main.js 的 setMode / spawn。
    /// 把 CameraRig / VertexPainter / TerrainGenerator / TaskBoard 串起来。</summary>
    public class WorkbenchManager : MonoBehaviour
    {
        public enum Mode { Select, Paint, Sculpt, Terrain }

        public Mode mode = Mode.Select;
        public CameraRig rig;
        public VertexPainter painter;
        public TerrainGenerator terrain;
        public TaskBoard board;

        void Update()
        {
            if (painter) painter.enabled = (mode == Mode.Paint);
            if (Input.GetKeyDown(KeyCode.W)) TryTransform(0);
            if (Input.GetKeyDown(KeyCode.E)) TryTransform(1);
            if (Input.GetKeyDown(KeyCode.R)) TryTransform(2);
        }

        void TryTransform(int k)
        {
            // 在 Unity 中直接用编辑器 Transform 工具即可；这里仅占位演示模式意图
            Debug.Log($"[ForgeVerse] transform mode {k} (select 模式下用编辑器工具)");
        }

        public void SpawnPrimitive(string type)
        {
            GameObject go = type switch
            {
                "sphere" => GameObject.CreatePrimitive(PrimitiveType.Sphere),
                "capsule" => GameObject.CreatePrimitive(PrimitiveType.Capsule),
                "cylinder" => GameObject.CreatePrimitive(PrimitiveType.Cylinder),
                "cone" => GameObject.CreatePrimitive(PrimitiveType.Cone),
                "torus" => GameObject.CreatePrimitive(PrimitiveType.Cylinder),
                _ => GameObject.CreatePrimitive(PrimitiveType.Cube),
            };
            go.transform.position = new Vector3(Random.Range(-3, 3), 1, Random.Range(-3, 3));
            board?.Add("放置 " + type);
        }
    }
}
