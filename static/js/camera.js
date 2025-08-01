(async () => {
  const preview        = document.getElementById("preview");
  const recordBtn      = document.getElementById("record-video-btn");
  const recordedVideo  = document.getElementById("recorded-video");
  const photoBtn       = document.getElementById("take-photo-btn");
  const canvas         = document.getElementById("photo-canvas");
  const uploadBtn      = document.getElementById("upload-btn");
  const frontBtn       = document.getElementById("front-btn");
  const backBtn        = document.getElementById("back-btn");

  let stream = null;
  let recordedBlob = null;
  let photoBlob    = null;
  let recordMime   = "video/webm";

  // カメラ開始（facingModeに非対応でも落ちないようにする）
  async function startCamera(facing = "user") {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: true
      });
      preview.srcObject = stream;
    } catch (err) {
      console.error("カメラ起動エラー:", err);
      alert("カメラ切替に失敗しました");
    }
  }

  // 初期は前面カメラ
  await startCamera("user");

  // 切替ボタン
  if (frontBtn) {
  frontBtn.onclick = () => startCamera("user");
}
if (backBtn) {
  backBtn.onclick  = () => startCamera("environment");
}

  // 動画録画
  recordBtn.onclick = () => {
    let options = { mimeType: "video/mp4" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
    }
    recordMime = options.mimeType;

    const recorder = new MediaRecorder(stream, options);
    const chunks   = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: recordMime });
      recordedVideo.src = URL.createObjectURL(recordedBlob);
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 8000);
  };

  // 静止画撮影
  photoBtn.onclick = () => {
  const ctx = canvas.getContext("2d");
  canvas.width = preview.videoWidth || 640;
  canvas.height = preview.videoHeight || 480;
  ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(b => { 
    photoBlob = b; 
    console.log("📸 写真撮影OK（最新1枚）");
  }, "image/png", 1.0);  // 高品質カラー
};

  // 保存＆アップロード
  uploadBtn.onclick = async () => {
    let uploaded = false;

    if (photoBlob) {
      const formImg = new FormData();
      formImg.append("media_type", "image");
      formImg.append("file", photoBlob, "photo.png");
      await fetch("/upload_media", { method: "POST", body: formImg });
      uploaded = true;
    }
    if (recordedBlob) {
      const ext = recordMime === "video/mp4" ? "mp4" : "webm";
      const formVid = new FormData();
      formVid.append("media_type", "video");
      formVid.append("file", recordedBlob, `movie.${ext}`);
      await fetch("/upload_media", { method: "POST", body: formVid });
      uploaded = true;
    }

    if (uploaded) {
      window.location.href = "/daily_report";
    } else {
      alert("保存する写真または動画がありません。");
    }
  };
})();