/**
 * Device fingerprinting from the browser.
 *
 * A page cannot read the machine's host name or MAC address: the platform does
 * not expose them to JavaScript. What it can do is describe itself (platform,
 * screen, timezone, memory) and, on some browsers, reveal a local IPv4 through
 * WebRTC ICE candidates. The server combines that with reverse DNS and its own
 * neighbour table to build the device entry.
 */

export interface DeviceHints {
  name: string;
  platform: string;
  language: string;
  timezone: string;
  screen: string;
  dpr: number;
  cores: number;
  memoryGb?: number;
  touch: boolean;
  localIp: string;
  browser: string;
  os: string;
  type: "desktop" | "phone" | "tablet";
}

export function describeBrowser(ua = navigator.userAgent) {
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\//i.test(ua)
      ? "Opera"
      : /Firefox\//i.test(ua)
        ? "Firefox"
        : /Chrome\//i.test(ua)
          ? "Chrome"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown OS";
  const type: DeviceHints["type"] = /iPad|Tablet/i.test(ua)
    ? "tablet"
    : /Android|iPhone|iPod|Mobile/i.test(ua)
      ? "phone"
      : "desktop";
  return { browser, os, type, label: `${browser} on ${os}` };
}

function platformName(): string {
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  const raw = uaData?.platform || navigator.platform || "";
  if (/^win/i.test(raw)) return "Windows";
  if (/mac/i.test(raw)) return "macOS";
  if (/^linux/i.test(raw)) return "Linux";
  if (/android/i.test(raw)) return "Android";
  if (/iphone|ipad|ipod/i.test(raw)) return "iOS";
  return raw;
}

/** Everything except the WebRTC probe, which takes a moment. */
export function quickHints(): DeviceHints {
  const p = describeBrowser();
  return {
    name: p.os === "Unknown OS" ? `${p.browser} device` : `${p.browser} on ${p.os}`,
    platform: platformName(),
    language: navigator.language || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "",
    dpr: typeof window !== "undefined" ? Math.round((window.devicePixelRatio || 1) * 100) / 100 : 1,
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    touch: (navigator.maxTouchPoints || 0) > 0,
    localIp: "",
    browser: p.browser,
    os: p.os,
    type: p.type,
  };
}

/**
 * Best-effort local IPv4 from WebRTC ICE candidates. Chrome and Safari hand out
 * mDNS host names (`abcd.local`) instead of raw addresses on most networks, in
 * which case this returns an empty string and the server falls back to the
 * address it sees on the socket.
 */
export function probeLocalIp(timeoutMs = 1600): Promise<string> {
  if (typeof window === "undefined" || typeof window.RTCPeerConnection === "undefined") return Promise.resolve("");
  return new Promise((resolve) => {
    const found = new Set<string>();
    let pc: RTCPeerConnection | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      try {
        pc?.close();
      } catch {
        /* already closed */
      }
      pc = null;
      resolve([...found][0] ?? "");
    };
    try {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel("fyrdrop");
      pc.onicecandidate = (e) => {
        const text = e.candidate?.candidate ?? "";
        const m = /(?:\d{1,3}\.){3}\d{1,3}/.exec(text);
        if (m && m[0] !== "0.0.0.0" && !m[0].startsWith("127.") && !m[0].startsWith("169.254.")) found.add(m[0]);
        if (!e.candidate) finish();
      };
      timer = setTimeout(finish, timeoutMs);
      void pc
        .createOffer()
        .then((offer) => pc?.setLocalDescription(offer))
        .catch(finish);
    } catch {
      finish();
    }
  });
}

export async function collectHints(): Promise<DeviceHints> {
  const hints = quickHints();
  hints.localIp = await probeLocalIp();
  return hints;
}
