// Library and Now Playing keep their widths across launches; small screens use CSS.
export function installPanelSizing() {
  const shell = document.querySelector(".app-shell");
  const workspace = shell.querySelector(".workspace");
  const handles = [...workspace.querySelectorAll("[data-resize-panel]")];
  const value = (side) =>
    parseFloat(
      getComputedStyle(shell).getPropertyValue(
        side === "library" ? "--sidebar" : "--right",
      ),
    );
  const limits = (side) => ({
    min: side === "library" ? 190 : 240,
    max: Math.max(
      side === "library" ? 190 : 240,
      Math.min(
        side === "library" ? 440 : 420,
        workspace.clientWidth -
          value(side === "library" ? "right" : "library") -
          380,
      ),
    ),
  });
  function apply(side, width, save = false) {
    const { min, max } = limits(side);
    const next = Math.round(Math.min(max, Math.max(min, width)));
    shell.style.setProperty(
      side === "library" ? "--sidebar" : "--right",
      `${next}px`,
    );
    const handle = handles.find((h) => h.dataset.resizePanel === side);
    handle.setAttribute("aria-valuenow", String(next));
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    if (save) localStorage.setItem(`rustify-width-${side}`, String(next));
  }
  function restore() {
    if (innerWidth <= 960) {
      shell.style.removeProperty("--sidebar");
      shell.style.removeProperty("--right");
      return;
    }
    for (const side of ["library", "right"]) {
      const saved = Number(localStorage.getItem(`rustify-width-${side}`));
      if (saved) apply(side, saved);
    }
  }
  restore();
  window.addEventListener("resize", restore);
  for (const handle of handles) {
    const side = handle.dataset.resizePanel;
    handle.addEventListener("pointerdown", (event) => {
      if (
        innerWidth <= 960 ||
        (side === "library" && shell.classList.contains("library-collapsed"))
      )
        return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const start = event.clientX,
        width = value(side);
      const move = (e) =>
        apply(
          side,
          width + (e.clientX - start) * (side === "library" ? 1 : -1),
        );
      const finish = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        apply(side, value(side), true);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
    handle.addEventListener("keydown", (event) => {
      if (
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
        innerWidth <= 960
      )
        return;
      if (side === "library" && shell.classList.contains("library-collapsed"))
        return;
      event.preventDefault();
      const { min, max } = limits(side);
      apply(
        side,
        event.key === "Home"
          ? min
          : event.key === "End"
            ? max
            : value(side) +
              (event.key === "ArrowRight" ? 16 : -16) *
                (side === "library" ? 1 : -1),
        true,
      );
    });
  }
}
