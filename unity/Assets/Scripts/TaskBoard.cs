using System;
using System.Collections.Generic;
using UnityEngine;

namespace ForgeVerse
{
    /// <summary>任务工作台 + 经验/等级/成就。对应网页版 tasks.js。
    /// 完成任务 +20 XP，达到阈值升级并触发成就事件。</summary>
    [CreateAssetMenu(menuName = "ForgeVerse/TaskBoard")]
    public class TaskBoard : ScriptableObject
    {
        public int xp;
        public int level = 1;
        public List<Task> tasks = new List<Task>();

        [Serializable] public class Task { public string text; public bool done; }

        public event Action<int> OnLevelUp;
        public event Action<string> OnAchievement;

        HashSet<int> unlocked = new HashSet<int>();
        readonly (int n, string name)[] ACH =
        {
            (1, "初出茅庐"), (5, "小有成效"), (10, "建造师"), (20, "造物大师")
        };

        public void Add(string text) { if (!string.IsNullOrWhiteSpace(text)) tasks.Add(new Task { text = text }); }

        public void Complete(int i)
        {
            if (i < 0 || i >= tasks.Count || tasks[i].done) return;
            tasks[i].done = true;
            AddXP(20);
            int done = 0; foreach (var t in tasks) if (t.done) done++;
            foreach (var a in ACH)
                if (done >= a.n && !unlocked.Contains(a.n)) { unlocked.Add(a.n); OnAchievement?.Invoke(a.name); }
        }

        void AddXP(int n)
        {
            xp += n;
            int need = level * 100;
            while (xp >= need) { xp -= need; level++; need = level * 100; OnLevelUp?.Invoke(level); }
        }
    }
}
