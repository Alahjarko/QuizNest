export function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;
}

export function startElapsedTimer(target, label) {
  if (!target) {
    return { stop() {} };
  }

  const start = Date.now();
  const render = () => {
    target.textContent = `${label} ${formatElapsed(Date.now() - start)}`;
  };

  render();
  const timer = window.setInterval(render, 1000);
  return {
    stop() {
      window.clearInterval(timer);
    }
  };
}
