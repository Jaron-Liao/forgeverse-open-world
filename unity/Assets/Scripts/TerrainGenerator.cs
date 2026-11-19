using UnityEngine;

namespace ForgeVerse
{
    /// <summary>高度图地形 + 雕刻笔刷。对应网页版 world.js 的 generateTerrain / sculptAt。</summary>
    [RequireComponent(typeof(Terrain))]
    public class TerrainGenerator : MonoBehaviour
    {
        public int seed = 7;
        [Range(0f, 8f)] public float height = 3f;
        public enum SculptMode { Raise, Lower, Smooth }
        public SculptMode sculptMode = SculptMode.Raise;
        public float brushSize = 3f;
        public float brushStrength = 1.2f;

        Terrain terr; TerrainData data;

        void Start() => Generate();

        float Hash(int i, int j)
        {
            int n = i * 374761393 + j * 668265263 + seed * 982451653;
            n = (n ^ (n >> 13)) * 1274126177;
            return ((n ^ (n >> 16)) & 0x7fffffff) / 2147483647f;
        }
        float Noise(float x, float z)
        {
            int xi = Mathf.FloorToInt(x), zi = Mathf.FloorToInt(z);
            float xf = x - xi, zf = z - zi;
            float u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
            float a = Hash(xi, zi), b = Hash(xi + 1, zi), c = Hash(xi, zi + 1), d = Hash(xi + 1, zi + 1);
            return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
        }
        float Fbm(float x, float z)
        {
            float h = 0, amp = 0.5f, f = 1;
            for (int o = 0; o < 4; o++) { h += Noise(x * f, z * f) * amp; amp *= 0.5f; f *= 2; }
            return h;
        }

        public void Generate()
        {
            terr = GetComponent<Terrain>(); data = terr.terrainData;
            int r = data.heightmapResolution;
            float[,] hm = new float[r, r];
            for (int y = 0; y < r; y++)
                for (int x = 0; x < r; x++)
                {
                    float nx = x / (float)(r - 1) * 80f, nz = y / (float)(r - 1) * 80f;
                    float hgt = Fbm(nx * 0.04f + 100, nz * 0.04f + 100) * height;
                    float dist = Vector2.Distance(new Vector2(nx, nz), Vector2.zero);
                    if (dist > 36) hgt *= Mathf.Max(0, 1 - (dist - 36) / 6);
                    hm[x, y] = hgt / data.size.y;
                }
            data.SetHeights(0, 0, hm);
        }

        /// <summary>在 worldPos 处施加雕刻，对应网页版 sculptAt。</summary>
        public void Sculpt(Vector3 worldPos)
        {
            Vector3 local = worldPos - transform.position;
            int cx = Mathf.RoundToInt(local.x / data.size.x * (data.heightmapResolution - 1));
            int cy = Mathf.RoundToInt(local.z / data.size.z * (data.heightmapResolution - 1));
            int rad = Mathf.RoundToInt(brushSize);
            float[,] hm = data.GetHeights(0, 0, data.heightmapResolution, data.heightmapResolution);
            for (int y = -rad; y <= rad; y++)
                for (int x = -rad; x <= rad; x++)
                {
                    int ix = cx + x, iy = cy + y;
                    if (ix < 0 || iy < 0 || ix >= data.heightmapResolution || iy >= data.heightmapResolution) continue;
                    float d = Mathf.Sqrt(x * x + y * y);
                    if (d > rad) continue;
                    float t = 1 - d / rad;
                    float sign = sculptMode == SculptMode.Lower ? -1 : 1;
                    hm[ix, iy] = Mathf.Clamp01(hm[ix, iy] + sign * brushStrength * t * 0.02f);
                }
            data.SetHeights(0, 0, hm);
        }
    }
}
