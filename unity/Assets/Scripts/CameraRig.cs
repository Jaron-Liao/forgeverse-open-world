using UnityEngine;

namespace ForgeVerse
{
    /// <summary>轨道相机 + 昼夜方向光。对应网页版 engine.js 的 OrbitControls + setTimeOfDay。</summary>
    public class CameraRig : MonoBehaviour
    {
        public Transform target;
        public Light sun;
        public float distance = 22f;
        public float height = 12f;
        [Range(0f, 1f)] public float timeOfDay = 0.55f;
        public bool autoCycle;

        float ang;

        void Update()
        {
            if (autoCycle) timeOfDay = (timeOfDay + Time.deltaTime * 0.02f) % 1f;
            ang = timeOfDay * Mathf.PI * 2f - Mathf.PI / 2f;
            if (target) transform.position = target.position + new Vector3(Mathf.Cos(ang) * distance, Mathf.Sin(ang) * 30f + 4f, 18f);
            transform.LookAt(target ? target.position : Vector3.zero);

            if (sun)
            {
                float day = Mathf.Clamp01(Mathf.Sin(ang) + 0.3f);
                sun.intensity = 0.3f + day * 2.2f;
                sun.transform.position = new Vector3(Mathf.Cos(ang) * 40f, Mathf.Sin(ang) * 38f + 4f, 18f);
                RenderSettings.ambientIntensity = 0.25f + day * 0.6f;
            }
        }
    }
}
