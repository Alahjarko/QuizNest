import { openModal } from "./Modal.js";

export function openAvatarCropper(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const CROP_SIZE = 300;
      const CROP_OFFSET = 50;
      
      let scale = 1;
      let minScale = 1;
      let maxScale = 5;
      let translateX = 0;
      let translateY = 0;

      const minScaleX = CROP_SIZE / img.naturalWidth;
      const minScaleY = CROP_SIZE / img.naturalHeight;
      minScale = Math.max(minScaleX, minScaleY);
      scale = minScale;

      translateX = CROP_OFFSET + (CROP_SIZE - img.naturalWidth * scale) / 2;
      translateY = CROP_OFFSET + (CROP_SIZE - img.naturalHeight * scale) / 2;

      const content = document.createElement("div");
      content.innerHTML = `
        <div class="avatar-cropper-container" style="position: relative; width: 400px; height: 400px; overflow: hidden; background: var(--bg-deep); touch-action: none; border-radius: 8px; margin: 0 auto; user-select: none; cursor: move;">
          <img class="avatar-cropper-image" src="${objectUrl}" style="position: absolute; transform-origin: 0 0; user-select: none; pointer-events: none;" draggable="false" />
          <div class="avatar-cropper-mask" style="position: absolute; top: 50px; left: 50px; width: 300px; height: 300px; box-shadow: 0 0 0 1000px rgba(0,0,0,0.5); border: 2px solid var(--accent); border-radius: 8px; pointer-events: none; box-sizing: border-box;"></div>
        </div>
        <div class="form-actions" style="margin-top: 24px; justify-content: flex-end;">
          <p style="margin: 0 auto 0 0; color: var(--text-muted); font-size: 13px; line-height: 36px;">拖拽图片调整区域，支持滚轮缩放</p>
          <button class="secondary-button" type="button" data-cancel>取消</button>
          <button class="primary-button" type="button" data-confirm>确认裁剪</button>
        </div>
      `;

      const { close } = openModal({
        title: "调整头像",
        content,
        width: "480px"
      });

      const container = content.querySelector(".avatar-cropper-container");
      const imageEl = content.querySelector(".avatar-cropper-image");
      
      const updateTransform = () => {
        // Enforce constraints
        const maxTx = CROP_OFFSET;
        const minTx = CROP_OFFSET + CROP_SIZE - img.naturalWidth * scale;
        const maxTy = CROP_OFFSET;
        const minTy = CROP_OFFSET + CROP_SIZE - img.naturalHeight * scale;
        
        translateX = Math.min(maxTx, Math.max(minTx, translateX));
        translateY = Math.min(maxTy, Math.max(minTy, translateY));
        
        imageEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      };

      updateTransform();

      // Drag logic
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let initialTx = 0;
      let initialTy = 0;

      container.addEventListener("pointerdown", (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialTx = translateX;
        initialTy = translateY;
        container.setPointerCapture(e.pointerId);
      });

      container.addEventListener("pointermove", (e) => {
        if (!isDragging) return;
        translateX = initialTx + (e.clientX - startX);
        translateY = initialTy + (e.clientY - startY);
        updateTransform();
      });

      container.addEventListener("pointerup", (e) => {
        isDragging = false;
        container.releasePointerCapture(e.pointerId);
      });

      container.addEventListener("pointercancel", () => {
        isDragging = false;
      });

      // Zoom logic
      container.addEventListener("wheel", (e) => {
        e.preventDefault();
        const zoomSensitivity = 0.002;
        const delta = e.deltaY * -zoomSensitivity;
        const oldScale = scale;
        scale = Math.min(maxScale, Math.max(minScale, scale + delta * scale));
        
        // Zoom towards center of crop box (200, 200)
        const centerX = 200;
        const centerY = 200;
        
        translateX = centerX - (centerX - translateX) * (scale / oldScale);
        translateY = centerY - (centerY - translateY) * (scale / oldScale);
        
        updateTransform();
      }, { passive: false });

      content.querySelector("[data-cancel]").addEventListener("click", () => {
        URL.revokeObjectURL(objectUrl);
        close();
        resolve(null);
      });

      content.querySelector("[data-confirm]").addEventListener("click", () => {
        const sourceX = (CROP_OFFSET - translateX) / scale;
        const sourceY = (CROP_OFFSET - translateY) / scale;
        const sourceSize = CROP_SIZE / scale;
        
        const targetSize = Math.min(512, sourceSize);
        
        const canvas = document.createElement("canvas");
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext("2d");
        
        // Ensure image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        
        ctx.drawImage(
          img,
          sourceX, sourceY, sourceSize, sourceSize,
          0, 0, targetSize, targetSize
        );
        
        const dataUrl = canvas.toDataURL("image/webp", 0.85);
        URL.revokeObjectURL(objectUrl);
        close();
        resolve(dataUrl);
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败，请上传正确的图片文件"));
    };

    img.src = objectUrl;
  });
}
