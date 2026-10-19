// app-demo recorder helper (Windows): lists windows, shows the floating record bar, logs the mouse.
// ffmpeg does the capture; this program tells it what to capture and when, and reports input as JSON lines.
// Commands: list | monitors | testwin [w h secs] | rec [--hwnd N | --match text] [--mode window|area|screen]
//           [--monitor N] [--note text] [--lang zh|en] [--max sec] [--now] [--hidden-bar] [--fake file]
// Built by record-app.mjs with the C# compiler that ships with Windows (C# 5). From Cutroom (MIT).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int L, T, R, B; }
[StructLayout(LayoutKind.Sequential)]
public struct POINT { public int X, Y; }
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct MONITORINFOEX {
  public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
}
[StructLayout(LayoutKind.Sequential)]
public struct MSLL { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }

static class N {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  public delegate bool MonEnum(IntPtr m, IntPtr hdc, ref RECT r, IntPtr d);
  public delegate IntPtr HookProc(int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT p, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFOEX mi);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonEnum cb, IntPtr d);
  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr m, int type, out uint x, out uint y);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int id, HookProc p, IntPtr mod, uint tid);
  [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr h, uint a);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}

static class J {
  public static string S(string s) {
    if (s == null) return "null";
    var b = new StringBuilder("\"");
    foreach (char c in s) {
      if (c == '"') b.Append("\\\"");
      else if (c == '\\') b.Append("\\\\");
      else if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }
  public static string R(RECT r) { return "{\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + "}"; }
  public static string F(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }
}

class Win {
  public IntPtr H; public string Title, Exe, Cls; public uint Pid; public RECT Frame, Client; public bool Min; public IntPtr Mon;
}

static class Wins {
  public static RECT FrameOf(IntPtr h) {
    RECT r;
    if (N.DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) N.GetWindowRect(h, out r);
    return r;
  }
  public static RECT ClientOf(IntPtr h) {
    RECT c; N.GetClientRect(h, out c);
    var p = new POINT(); N.ClientToScreen(h, ref p);
    var r = new RECT(); r.L = p.X; r.T = p.Y; r.R = p.X + c.R; r.B = p.Y + c.B;
    return r;
  }
  public static string ExeOf(uint pid) {
    try { return Process.GetProcessById((int)pid).ProcessName + ".exe"; } catch { return ""; }
  }
  // Top-level windows a person would call a window, front to back
  public static List<Win> All() {
    var list = new List<Win>();
    uint me = (uint)Process.GetCurrentProcess().Id;
    N.EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!N.IsWindowVisible(h) || N.GetWindow(h, 4) != IntPtr.Zero) return true;
      int ex = N.GetWindowLong(h, -20);
      if ((ex & 0x80) != 0) return true; // tool window
      int cloaked; if (N.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var sb = new StringBuilder(512); N.GetWindowText(h, sb, 512);
      string title = sb.ToString();
      if (title.Length == 0) return true;
      var cb = new StringBuilder(256); N.GetClassName(h, cb, 256);
      string cls = cb.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd") return true;
      uint pid; N.GetWindowThreadProcessId(h, out pid);
      if (pid == me) return true;
      var w = new Win(); w.H = h; w.Title = title; w.Cls = cls; w.Pid = pid; w.Exe = ExeOf(pid);
      w.Frame = FrameOf(h); w.Client = ClientOf(h); w.Min = N.IsIconic(h); w.Mon = N.MonitorFromWindow(h, 2);
      if (!w.Min && (w.Frame.R - w.Frame.L < 40 || w.Frame.B - w.Frame.T < 40)) return true;
      list.Add(w);
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static Win Find(string text) {
    string t = text.ToLowerInvariant();
    foreach (var w in All()) if (!w.Min && (w.Title.ToLowerInvariant().Contains(t) || w.Exe.ToLowerInvariant().Contains(t))) return w;
    foreach (var w in All()) if (w.Title.ToLowerInvariant().Contains(t) || w.Exe.ToLowerInvariant().Contains(t)) return w;
    return null;
  }
  public static Win Of(IntPtr h) {
    if (!N.IsWindow(h)) return null;
    var sb = new StringBuilder(512); N.GetWindowText(h, sb, 512);
    var w = new Win(); w.H = h; w.Title = sb.ToString();
    uint pid; N.GetWindowThreadProcessId(h, out pid); w.Pid = pid; w.Exe = ExeOf(pid);
    w.Frame = FrameOf(h); w.Client = ClientOf(h); w.Min = N.IsIconic(h); w.Mon = N.MonitorFromWindow(h, 2);
    return w;
  }
}

class Mon { public IntPtr H; public RECT R; public bool Primary; public double Scale; public int Index; }

static class Mons {
  public static List<Mon> All() {
    var list = new List<Mon>();
    N.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr m, IntPtr hdc, ref RECT r, IntPtr d) {
      var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      N.GetMonitorInfo(m, ref mi);
      var x = new Mon(); x.H = m; x.R = mi.rcMonitor; x.Primary = (mi.dwFlags & 1) != 0; x.Scale = ScaleOf(m); x.Index = list.Count;
      list.Add(x);
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static double ScaleOf(IntPtr m) {
    uint dx, dy;
    return N.GetDpiForMonitor(m, 0, out dx, out dy) == 0 ? dx / 96.0 : 1.0;
  }
  public static Mon Of(IntPtr h) {
    foreach (var m in All()) if (m.H == h) return m;
    var all = All();
    return all.Count > 0 ? all[0] : null;
  }
}

// One JSON line per event, written off the hook thread so a slow reader never stalls the mouse
static class Out {
  static BlockingCollection<string> q = new BlockingCollection<string>();
  static Thread th;
  public static void Start() {
    var o = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)); o.AutoFlush = true;
    th = new Thread(delegate () { foreach (var s in q.GetConsumingEnumerable()) { try { o.WriteLine(s); } catch { } } });
    th.IsBackground = true; th.Start();
  }
  public static void Line(string s) { q.Add(s); }
  public static void Flush() { q.CompleteAdding(); if (th != null) th.Join(2000); }
  public static long Ms() { return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds; }
}

class TestWin : Form {
  int n; System.Windows.Forms.Timer tm; bool still, slow; long lastSlot = -1;
  public TestWin(int w, int h, string kind) {
    still = kind == "still"; slow = kind == "slow";
    Text = "app-demo capture test"; FormBorderStyle = FormBorderStyle.FixedSingle; StartPosition = FormStartPosition.Manual;
    ClientSize = new Size(w, h); DoubleBuffered = true;
    tm = new System.Windows.Forms.Timer(); tm.Interval = 16; tm.Tick += delegate {
      if (still) return;
      // slow: repaint twice a second, so only those frames change
      if (slow) { long slot = Out.Ms() / 500; if (slot == lastSlot) return; lastSlot = slot; }
      n++; Invalidate();
    }; tm.Start();
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics; var r = ClientRectangle;
    using (var b = new LinearGradientBrush(r, Color.FromArgb(30, 60, 120), Color.FromArgb(20, 130, 110), 30f)) g.FillRectangle(b, r);
    int x = (int)((Math.Sin(n / 30.0) * 0.4 + 0.5) * (r.Width - 80));
    g.FillRectangle(Brushes.Gold, x, r.Height / 2 - 40, 80, 80);
    // Corner marks for checking the captured area
    g.FillRectangle(Brushes.Red, 0, 0, 12, 12); g.FillRectangle(Brushes.Lime, r.Width - 12, r.Height - 12, 12, 12);
    using (var f = new Font("Segoe UI", 20)) g.DrawString("frame " + n, f, Brushes.White, 20, 20);
    // Paint time: 24 bits of the epoch milliseconds as black/white cells along the bottom (sync tests decode it)
    long ms = Out.Ms();
    for (int i = 0; i < 24; i++) g.FillRectangle(((ms >> (23 - i)) & 1) == 1 ? Brushes.White : Brushes.Black, 16 + i * 16, r.Height - 32, 16, 16);
  }
}

class Bar : Form {
  public string Note = "", Status = "", Sub = "";
  public bool Zh = true;
  public string State = "wait"; // wait | starting | count | rec | saving
  public Action OnStart, OnStop, OnMark, OnCancel;
  public string KeyStart = "F9", KeyStop = "F10";
  double s;
  Rectangle bStart, bMark, bStop, bCancel;
  Point drag; bool dragging;
  public Bar(double scale) {
    s = scale;
    FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; ShowInTaskbar = false; TopMost = true;
    DoubleBuffered = true; BackColor = Color.FromArgb(24, 26, 31); Opacity = 0.97;
    Size = new Size(D(620), D(76));
    Text = "app-demo recorder";
  }
  int D(double v) { return (int)Math.Round(v * s); }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get { var cp = base.CreateParams; cp.ExStyle |= 0x08000000 | 0x80 | 0x8; return cp; } // noactivate, toolwindow, topmost
  }
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x21) { m.Result = (IntPtr)3; return; } // WM_MOUSEACTIVATE → MA_NOACTIVATE
    if (m.Msg == 0x312) { // WM_HOTKEY
      int id = m.WParam.ToInt32();
      if (id == 1) { if (State == "wait") Fire(OnStart); else if (State == "rec") Fire(OnMark); }
      if (id == 2 && State == "rec") Fire(OnStop);
    }
    base.WndProc(ref m);
  }
  void Fire(Action a) { if (a != null) a(); }
  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    using (var p = Round(new Rectangle(0, 0, Width, Height), D(14))) Region = new Region(p);
  }
  static GraphicsPath Round(Rectangle r, int rad) {
    var p = new GraphicsPath(); int d = rad * 2;
    p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
    p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure();
    return p;
  }
  string T(string en, string zh) { return Zh ? zh : en; }
  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
    string face = Zh ? "Microsoft YaHei UI" : "Segoe UI";
    // Red dot: solid while recording, hollow otherwise
    var dot = new Rectangle(D(18), D(28), D(18), D(18));
    using (var red = new SolidBrush(Color.FromArgb(255, 77, 79))) using (var pen = new Pen(Color.FromArgb(255, 77, 79), D(2.5)))
      if (State == "rec") g.FillEllipse(red, dot); else g.DrawEllipse(pen, dot);
    int right = Width - D(12);
    bStart = bMark = bStop = bCancel = Rectangle.Empty;
    Func<string, bool, Rectangle> add = delegate (string label, bool primary) {
      var sz = g.MeasureString(label, Fnt(face, 13, true));
      int w = (int)sz.Width + D(22);
      var r = new Rectangle(right - w, D(20), w, D(36));
      right -= w + D(8);
      using (var p = Round(r, D(8))) using (var b = new SolidBrush(primary ? Color.FromArgb(220, 53, 69) : Color.FromArgb(58, 62, 72))) g.FillPath(b, p);
      g.DrawString(label, Fnt(face, 13, true), Brushes.White, r.X + (r.Width - sz.Width) / 2, r.Y + (r.Height - sz.Height) / 2);
      return r;
    };
    if (State == "wait") { bCancel = add(T("Cancel", "取消"), false); bStart = add(T("Start  ", "开始  ") + KeyStart, true); }
    else if (State == "rec") { bStop = add(T("Stop  ", "停止  ") + KeyStop, true); bMark = add(T("Mark  ", "标记  ") + KeyStart, false); }
    else if (State == "count") bCancel = add(T("Cancel", "取消"), false);
    int left = D(48);
    var textW = Math.Max(D(80), right - left - D(6));
    g.DrawString(Status, Fnt(face, 15, true), Brushes.White, new RectangleF(left, D(12), textW, D(24)));
    string sub = Sub.Length > 0 ? Sub : Note;
    using (var b = new SolidBrush(Color.FromArgb(214, 218, 226)))
      g.DrawString(sub, Fnt(face, 13, false), b, new RectangleF(left, D(36), textW, D(36)), new StringFormat { Trimming = StringTrimming.EllipsisCharacter });
  }
  Dictionary<string, Font> fonts = new Dictionary<string, Font>();
  Font Fnt(string face, float pt, bool bold) {
    string k = face + pt + bold;
    Font f; if (!fonts.TryGetValue(k, out f)) { f = new Font(face, pt * (float)s, bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel); fonts[k] = f; }
    return f;
  }
  protected override void OnMouseDown(MouseEventArgs e) {
    if (bStart.Contains(e.Location)) { Fire(OnStart); return; }
    if (bStop.Contains(e.Location)) { Fire(OnStop); return; }
    if (bMark.Contains(e.Location)) { Fire(OnMark); return; }
    if (bCancel.Contains(e.Location)) { Fire(OnCancel); return; }
    dragging = true; drag = e.Location;
  }
  protected override void OnMouseMove(MouseEventArgs e) { if (dragging) Location = new Point(Location.X + e.X - drag.X, Location.Y + e.Y - drag.Y); }
  protected override void OnMouseUp(MouseEventArgs e) { dragging = false; }
}

class Rec {
  string mode = "window", match, note = "", fake;
  string[] markNames = new string[0]; int marked;
  IntPtr hwnd; int monIdx = -1; double max = 300; bool now, hidden, zh = true;
  Bar bar; Win target; Mon mon; RECT region; IntPtr hook; N.HookProc hookProc;
  bool going, stopped; long goMs; long lastMove; uint myPid = (uint)Process.GetCurrentProcess().Id;
  System.Windows.Forms.Timer tick;
  int countLeft;

  public Rec(string[] a) {
    for (int i = 1; i < a.Length; i++) {
      string k = a[i]; string v = i + 1 < a.Length ? a[i + 1] : "";
      if (k == "--hwnd") { hwnd = new IntPtr(long.Parse(v)); i++; }
      else if (k == "--match") { match = v; i++; }
      else if (k == "--mode") { mode = v; i++; }
      else if (k == "--monitor") { monIdx = int.Parse(v); i++; }
      else if (k == "--note") { note = v; i++; }
      else if (k == "--lang") { zh = v != "en"; i++; }
      else if (k == "--max") { max = double.Parse(v, CultureInfo.InvariantCulture); i++; }
      else if (k == "--fake") { fake = v; i++; }
      else if (k == "--marks") { markNames = v.Split(','); i++; }
      else if (k == "--now") now = true;
      else if (k == "--hidden-bar") hidden = true;
    }
  }
  string T(string en, string zh2) { return zh ? zh2 : en; }
  string Name() { return target != null ? (target.Title.Length > 40 ? target.Title.Substring(0, 40) + "…" : target.Title) : (match ?? ""); }

  public void Run() {
    Out.Start();
    var start = PickMonitor(null);
    bar = new Bar(start != null ? start.Scale : 1.0);
    bar.Zh = zh; bar.Note = note;
    bar.OnStart = Begin; bar.OnStop = delegate { Stop("user"); }; bar.OnMark = Mark; bar.OnCancel = Cancel;
    bar.Status = T("Ready to record", "准备录屏") + (match != null || hwnd != IntPtr.Zero ? ": " + (hwnd != IntPtr.Zero ? Title(hwnd) : match) : "");
    if (note.Length == 0) bar.Sub = T("Get the window ready, then press Start.", "把要录的窗口准备好，然后点开始。");
    if (start != null) bar.Location = new Point(start.R.L + (start.R.R - start.R.L - bar.Width) / 2, start.R.T + (int)(14 * start.Scale));
    bar.HandleCreated += delegate {
      N.SetWindowDisplayAffinity(bar.Handle, 0x11); // keep the bar out of every capture
      if (!N.RegisterHotKey(bar.Handle, 1, 0x4000, 0x78)) { N.RegisterHotKey(bar.Handle, 1, 0x4000 | 0x2 | 0x4, 0x78); bar.KeyStart = "Ctrl+Shift+F9"; }
      if (!N.RegisterHotKey(bar.Handle, 2, 0x4000, 0x79)) { N.RegisterHotKey(bar.Handle, 2, 0x4000 | 0x2 | 0x4, 0x79); bar.KeyStop = "Ctrl+Shift+F10"; }
    };
    tick = new System.Windows.Forms.Timer(); tick.Interval = 100; tick.Tick += delegate { Tick(); }; tick.Start();
    var input = new Thread(ReadInput); input.IsBackground = true; input.Start();
    if (fake == null) { hookProc = Hook; hook = N.SetWindowsHookEx(14, hookProc, N.GetModuleHandle(null), 0); }
    Out.Line("{\"ev\":\"ready\",\"keys\":[" + J.S(bar.KeyStart) + "," + J.S(bar.KeyStop) + "]}");
    if (hidden) { bar.Opacity = 0; bar.Location = new Point(-30000, -30000); }
    bar.Shown += delegate { if (now) Begin(); };
    Application.Run(bar);
    if (hook != IntPtr.Zero) N.UnhookWindowsHookEx(hook);
    Out.Flush();
  }

  string Title(IntPtr h) { var w = Wins.Of(h); return w != null ? w.Title : ""; }

  Mon PickMonitor(Win w) {
    var all = Mons.All();
    if (monIdx >= 0 && monIdx < all.Count) return all[monIdx];
    if (w != null) return Mons.Of(w.Mon);
    if (hwnd != IntPtr.Zero) { var x = Wins.Of(hwnd); if (x != null) return Mons.Of(x.Mon); }
    if (match != null) { var x = Wins.Find(match); if (x != null) return Mons.Of(x.Mon); }
    foreach (var m in all) if (m.Primary) return m;
    return all.Count > 0 ? all[0] : null;
  }

  // Start pressed: find what to capture and tell record-app.mjs, which starts ffmpeg and answers "capturing"
  void Begin() {
    if (bar.State != "wait") return;
    if (mode != "screen") {
      target = hwnd != IntPtr.Zero ? Wins.Of(hwnd) : match != null ? Wins.Find(match) : null;
      if (target == null && now) { Out.Line("{\"ev\":\"error\",\"msg\":" + J.S("no window matches " + (match ?? hwnd.ToString())) + "}"); return; }
      if (target == null) { bar.Sub = T("No window matches \"" + (match ?? hwnd.ToString()) + "\". Open it, then press Start again.", "没找到窗口「" + (match ?? hwnd.ToString()) + "」，打开它后再点开始。"); bar.Invalidate(); return; }
      if (target.Min) { bar.Sub = T("The window is minimized. Restore it, then press Start.", "窗口是最小化的，先把它打开，再点开始。"); bar.Invalidate(); return; }
    }
    mon = PickMonitor(target);
    if (mon == null) { Out.Line("{\"ev\":\"error\",\"msg\":\"no monitor\"}"); Application.Exit(); return; }
    // Window capture records the client area (no title bar); positions are relative to its corner
    if (mode == "window") region = target.Client;
    else if (mode == "area") region = Clip(target.Frame, mon.R);
    else region = mon.R;
    if (mode != "window") { region.R -= (region.R - region.L) % 2; region.B -= (region.B - region.T) % 2; }
    bar.State = "starting"; bar.Status = T("Starting…", "正在启动…"); bar.Sub = note; bar.Invalidate();
    var sb = new StringBuilder("{\"ev\":\"target\",\"mode\":" + J.S(mode));
    if (target != null) sb.Append(",\"hwnd\":" + target.H.ToInt64() + ",\"title\":" + J.S(target.Title) + ",\"exe\":" + J.S(target.Exe) + ",\"frame\":" + J.R(target.Frame) + ",\"client\":" + J.R(target.Client));
    sb.Append(",\"region\":" + J.R(region) + ",\"monitor\":{\"handle\":" + mon.H.ToInt64() + ",\"index\":" + mon.Index + ",\"rect\":" + J.R(mon.R) + "},\"scale\":" + J.F(mon.Scale) + "}");
    Out.Line(sb.ToString());
  }
  static RECT Clip(RECT a, RECT m) {
    var r = new RECT(); r.L = Math.Max(a.L, m.L); r.T = Math.Max(a.T, m.T); r.R = Math.Min(a.R, m.R); r.B = Math.Min(a.B, m.B);
    return r;
  }

  void ReadInput() {
    string line;
    try {
      while ((line = Console.In.ReadLine()) != null) {
        string l = line.Trim();
        if (l == "capturing") bar.BeginInvoke((Action)Countdown);
        else if (l.StartsWith("status ")) { string t = l.Substring(7); bar.BeginInvoke((Action)delegate { bar.Status = t; bar.Sub = ""; bar.Invalidate(); }); }
        else if (l == "stop") bar.BeginInvoke((Action)delegate { Stop("user"); });
        else if (l == "cancel") bar.BeginInvoke((Action)Cancel);
        else if (l == "quit") break;
      }
    } catch { }
    try { bar.BeginInvoke((Action)delegate { Application.Exit(); }); } catch { }
  }

  void Countdown() {
    bar.State = "count"; countLeft = 3; bar.Invalidate();
    var t = new System.Windows.Forms.Timer(); t.Interval = 700;
    Action show = delegate { bar.Status = T("Recording in ", "即将开始录制 ") + countLeft + "…"; bar.Sub = note; bar.Invalidate(); };
    show();
    t.Tick += delegate {
      if (bar.State != "count") { t.Stop(); return; }
      countLeft--;
      if (countLeft > 0) { show(); return; }
      t.Stop(); Go();
    };
    t.Start();
  }

  void Go() {
    going = true; goMs = Out.Ms(); bar.State = "rec";
    Out.Line("{\"ev\":\"go\",\"ms\":" + goMs + "}");
    // Where the pointer starts, so it shows from the first frame
    POINT cp; int cx, cy;
    if (fake == null && N.GetCursorPos(out cp) && Rel(cp, out cx, out cy)) Out.Line("{\"ev\":\"move\",\"ms\":" + goMs + ",\"x\":" + cx + ",\"y\":" + cy + "}");
    bar.Sub = NextMark();
    UpdateClock();
    if (fake != null) { var th = new Thread(RunFake); th.IsBackground = true; th.Start(); }
  }

  string NextMark() {
    string hint = marked < markNames.Length ? T("Press Mark at: ", "到这一刻点标记：") + markNames[marked] : T("Press Mark at moments a caption should line up with.", "到需要配字幕的时刻点标记。");
    return note.Length > 0 ? note + "  ·  " + hint : hint;
  }

  void UpdateClock() {
    double sec = (Out.Ms() - goMs) / 1000.0;
    bar.Status = T("Recording ", "录制中 ") + ((int)sec / 60) + ":" + ((int)sec % 60).ToString("00") + "  ·  " + Name();
    bar.Invalidate();
  }

  void Tick() {
    if (bar.State == "rec") {
      UpdateClock();
      if ((Out.Ms() - goMs) / 1000.0 >= max) Stop("max");
      if (target != null && !N.IsWindow(target.H)) Stop("closed");
      if (mode == "window" && target != null && N.IsWindow(target.H)) {
        var f = Wins.ClientOf(target.H);
        if (f.L != region.L || f.T != region.T) {
          // The capture follows the window; positions stay relative to its top-left corner
          region.R += f.L - region.L; region.B += f.T - region.T; region.L = f.L; region.T = f.T;
          Out.Line("{\"ev\":\"rect\",\"ms\":" + Out.Ms() + ",\"rect\":" + J.R(region) + "}");
        }
      }
    }
  }

  void Mark() {
    if (bar.State != "rec") return;
    Out.Line("{\"ev\":\"mark\",\"ms\":" + Out.Ms() + "}");
    string done = marked < markNames.Length ? markNames[marked] : "m" + (marked + 1);
    marked++;
    bar.Sub = T("Marked ", "已标记 ") + done + " @ " + J.F((Out.Ms() - goMs) / 1000.0) + "s  ·  " + NextMark(); bar.Invalidate();
  }

  void Stop(string why) {
    if (stopped || (bar.State != "rec" && bar.State != "count")) return;
    stopped = true; going = false;
    Out.Line("{\"ev\":\"stop\",\"ms\":" + Out.Ms() + ",\"why\":" + J.S(why) + "}");
    bar.State = "saving"; bar.Status = T("Saving the recording…", "正在保存录屏…"); bar.Sub = ""; bar.Invalidate();
    if (hidden || why == "closed") return;
  }

  void Cancel() {
    Out.Line("{\"ev\":\"cancel\",\"ms\":" + Out.Ms() + "}");
    stopped = true; going = false;
    Application.Exit();
  }

  // Position relative to the captured area, or null when outside it
  bool Rel(POINT p, out int x, out int y) {
    x = p.X - region.L; y = p.Y - region.T;
    return x >= 0 && y >= 0 && x < region.R - region.L && y < region.B - region.T;
  }

  bool OnBar(POINT p) {
    uint pid; N.GetWindowThreadProcessId(N.GetAncestor(N.WindowFromPoint(p), 2), out pid);
    return pid == myPid;
  }

  bool OnTarget(POINT p) {
    IntPtr w = N.GetAncestor(N.WindowFromPoint(p), 2);
    uint pid; N.GetWindowThreadProcessId(w, out pid);
    if (pid == myPid) return false;
    if (mode != "window") return true;
    return w == target.H || pid == target.Pid;
  }

  IntPtr Hook(int code, IntPtr wp, IntPtr lp) {
    if (code >= 0 && going) {
      var m = (MSLL)Marshal.PtrToStructure(lp, typeof(MSLL));
      int msg = wp.ToInt32(); int x, y;
      long ms = Out.Ms();
      if (Rel(m.pt, out x, out y)) {
        if (msg == 0x200) { if (ms - lastMove >= 15 && !OnBar(m.pt)) { lastMove = ms; Out.Line("{\"ev\":\"move\",\"ms\":" + ms + ",\"x\":" + x + ",\"y\":" + y + "}"); } }
        else if (msg == 0x201 || msg == 0x204 || msg == 0x207) { if (OnTarget(m.pt)) Out.Line("{\"ev\":\"down\",\"ms\":" + ms + ",\"x\":" + x + ",\"y\":" + y + ",\"b\":" + (msg == 0x201 ? "\"left\"" : msg == 0x204 ? "\"right\"" : "\"middle\"") + "}"); }
        else if (msg == 0x202 || msg == 0x205 || msg == 0x208) Out.Line("{\"ev\":\"up\",\"ms\":" + ms + ",\"x\":" + x + ",\"y\":" + y + "}");
        else if (msg == 0x20A) Out.Line("{\"ev\":\"scroll\",\"ms\":" + ms + ",\"x\":" + x + ",\"y\":" + y + ",\"d\":" + ((short)(m.mouseData >> 16)) + "}");
      }
    }
    return N.CallNextHookEx(hook, code, wp, lp);
  }

  // Tests: scripted input instead of the real mouse (move x y | down x y | up x y | mark | wait ms | stop)
  void RunFake() {
    foreach (var raw in File.ReadAllLines(fake)) {
      var p = raw.Trim().Split(' ');
      if (p.Length == 0 || p[0].Length == 0) continue;
      long ms = Out.Ms();
      if (p[0] == "wait") Thread.Sleep(int.Parse(p[1]));
      else if (p[0] == "mark") bar.BeginInvoke((Action)Mark);
      else if (p[0] == "stop") { bar.BeginInvoke((Action)delegate { Stop("user"); }); return; }
      else if (p[0] == "move" || p[0] == "down" || p[0] == "up") Out.Line("{\"ev\":" + J.S(p[0]) + ",\"ms\":" + ms + ",\"x\":" + p[1] + ",\"y\":" + p[2] + (p[0] == "down" ? ",\"b\":\"left\"" : "") + "}");
    }
  }
}

static class Program {
  static void Print(string s) {
    var b = new UTF8Encoding(false).GetBytes(s + "\n");
    using (var o = Console.OpenStandardOutput()) o.Write(b, 0, b.Length);
  }
  [STAThread]
  static int Main(string[] a) {
    N.SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: every coordinate in physical pixels
    string cmd = a.Length > 0 ? a[0] : "";
    if (cmd == "list") {
      var sb = new StringBuilder("[");
      var fg = N.GetForegroundWindow();
      bool first = true;
      foreach (var w in Wins.All()) {
        if (!first) sb.Append(","); first = false;
        var m = Mons.Of(w.Mon);
        sb.Append("{\"hwnd\":" + w.H.ToInt64() + ",\"title\":" + J.S(w.Title) + ",\"exe\":" + J.S(w.Exe) + ",\"pid\":" + w.Pid + ",\"frame\":" + J.R(w.Frame) + ",\"client\":" + J.R(w.Client) + ",\"minimized\":" + (w.Min ? "true" : "false") + ",\"foreground\":" + (w.H == fg ? "true" : "false") + ",\"monitor\":" + (m != null ? m.Index : 0) + "}");
      }
      Print(sb.Append("]").ToString());
      return 0;
    }
    if (cmd == "monitors") {
      var sb = new StringBuilder("[");
      var all = Mons.All();
      for (int i = 0; i < all.Count; i++) sb.Append((i > 0 ? "," : "") + "{\"index\":" + i + ",\"handle\":" + all[i].H.ToInt64() + ",\"rect\":" + J.R(all[i].R) + ",\"primary\":" + (all[i].Primary ? "true" : "false") + ",\"scale\":" + J.F(all[i].Scale) + "}");
      Print(sb.Append("]").ToString());
      return 0;
    }
    if (cmd == "testwin") {
      int w = a.Length > 1 ? int.Parse(a[1]) : 640, h = a.Length > 2 ? int.Parse(a[2]) : 360;
      double secs = a.Length > 3 ? double.Parse(a[3], CultureInfo.InvariantCulture) : 10;
      var f = new TestWin(w, h, a.Length > 4 ? a[4] : "anim");
      var wa = Screen.PrimaryScreen.WorkingArea;
      f.Location = new Point(wa.Right - f.Width - 20, wa.Bottom - f.Height - 20);
      f.Shown += delegate {
        N.SetWindowPos(f.Handle, new IntPtr(1), 0, 0, 0, 0, 0x13); // bottom of the z-order, no move/size/activate
        Print("{\"hwnd\":" + f.Handle.ToInt64() + ",\"frame\":" + J.R(Wins.FrameOf(f.Handle)) + ",\"client\":" + J.R(Wins.ClientOf(f.Handle)) + "}");
      };
      var t = new System.Windows.Forms.Timer(); t.Interval = (int)(secs * 1000); t.Tick += delegate { f.Close(); }; t.Start();
      Application.Run(f);
      return 0;
    }
    if (cmd == "rec") { new Rec(a).Run(); return 0; }
    if (cmd == "barshot") {
      // Draw the record bar into a PNG (for checking its look without touching the screen)
      var b = new Bar(a.Length > 4 ? double.Parse(a[4], CultureInfo.InvariantCulture) : 1.0);
      b.State = a.Length > 2 ? a[2] : "wait"; b.Zh = !(a.Length > 3 && a[3] == "en");
      b.Status = b.State == "rec" ? (b.Zh ? "录制中 0:12  ·  剪映专业版" : "Recording 0:12  ·  JianyingPro") : b.State == "count" ? (b.Zh ? "即将开始录制 2…" : "Recording in 2…") : (b.Zh ? "准备录屏：剪映" : "Ready to record: JianyingPro");
      b.Note = b.Zh ? "在剪映里把素材拖到时间线上，然后点停止" : "Drag a clip onto the timeline in JianyingPro, then press Stop";
      b.CreateControl();
      using (var bmp = new Bitmap(b.Width, b.Height)) { b.DrawToBitmap(bmp, new Rectangle(0, 0, b.Width, b.Height)); bmp.Save(a[1]); }
      return 0;
    }
    Console.Error.WriteLine("usage: list | monitors | testwin [w h secs] | rec [options]");
    return 2;
  }
}
