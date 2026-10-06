// "Chrome on Windows" from a user-agent string; good enough for recognising a device.
export function describeDevice(ua: string | null | undefined): { browser: string; os: string; mobile: boolean } | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : null;
  if (!browser || !os) return null;
  return { browser, os, mobile: /Mobi|Android|iPhone|iPad/.test(ua) };
}
