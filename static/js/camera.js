(async () => {
  const preview        = document.getElementById("preview");
  const recordBtn      = document.getElementById("record-video-btn");
  const recordedVideo  = document.getElementById("recorded-video");
  const photoBtn       = document.getElementById("take-photo-btn");
  const canvas         = document.getElementById("photo-canvas");
  const uploadBtn      = document.getElementById("upload-btn");

  // カメラ取得
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  preview.srcObject = stream;

  let recordedBlob = null;
  let photoBlob    = null;
  let recordMime   = "video/webm";

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
    setTimeout(() => recorder.stop(), 8_000);  // 8秒録画
  };

  // 静止画取得
  photoBtn.onclick = () => {
    const ctx = canvas.getContext("2d");
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => { photoBlob = b; }, "image/png");
  };

  // 保存＆アップロード
  uploadBtn.onclick = async () => {
    // 画像アップロード
    if (photoBlob) {
      const formImg = new FormData();
      formImg.append("media_type", "image");
      formImg.append("file", photoBlob, "photo.png");
      const resImg = await fetch("/upload_media", { method: "POST", body: formImg });
      console.log("image upload:", resImg.status, await resImg.json());
    }
    // 動画アップロード
    if (recordedBlob) {
      const ext = recordMime === "video/mp4" ? "mp4" : "webm";
      const formVid = new FormData();
      formVid.append("media_type", "video");
      formVid.append("file", recordedBlob, `movie.${ext}`);
      const resVid = await fetch("/upload_media", { method: "POST", body: formVid });
      console.log("video upload:", resVid.status, await resVid.json());
    }
    alert("保存＆アップロードしました");
  };
})();
