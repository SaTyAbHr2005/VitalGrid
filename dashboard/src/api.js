export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const WS_URL = `${API_URL.replace(/^http/, "ws")}/live`;

// Render free tier sleeps after 15 min idle; keep polling /health until it wakes (~1 min).
export async function waitForServer() {
  for (;;) {
    try {
      if ((await fetch(`${API_URL}/health`)).ok) return;
    } catch {
      /* still waking up */
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
}
