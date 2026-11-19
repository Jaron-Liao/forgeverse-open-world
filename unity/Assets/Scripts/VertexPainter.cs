using UnityEngine;

namespace ForgeVerse
{
    /// <summary>Blender 式顶点绘画。对应网页版 paint.js 的 paintVertex / prepMesh。
    /// 射线命中网格，在笔刷半径内的顶点写入颜色（需网格开启 Mesh.colors）。</summary>
    public class VertexPainter : MonoBehaviour
    {
        public Camera cam;
        public float brushSize = 1.4f;
        public float strength = 0.6f;
        public Color paintColor = Color.magenta;
        public bool erase;

        Mesh paintedMesh;
        Color[] baseColors;

        void Update()
        {
            if (!Input.GetMouseButton(0) || !cam) return;
            Ray ray = cam.ScreenPointToRay(Input.mousePosition);
            if (!Physics.Raycast(ray, out RaycastHit hit)) return;

            MeshFilter mf = hit.collider.GetComponent<MeshFilter>();
            if (!mf || !mf.sharedMesh) return;
            Mesh m = mf.sharedMesh;
            if (m.colors == null || m.colors.Length == 0)
            {
                baseColors = new Color[m.vertexCount];
                for (int i = 0; i < m.vertexCount; i++) baseColors[i] = m.vertices.Length > 0 ? Color.white : Color.white;
                m.colors = baseColors;
            }
            paintedMesh = m;
            Color[] cols = m.colors;
            Vector3 local = hit.transform.InverseTransformPoint(hit.point);
            for (int i = 0; i < m.vertexCount; i++)
            {
                float d = Vector3.Distance(m.vertices[i], local);
                if (d < brushSize)
                {
                    float t = (1 - d / brushSize) * strength;
                    Color target = erase ? Color.white : paintColor;
                    cols[i] = Color.Lerp(cols[i], target, t);
                }
            }
            m.colors = cols;
            m.RecalculateNormals();
        }
    }
}
