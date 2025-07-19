(async () => {
  const preview = document.getElementById("preview");
  const recordBtn = document.getElementById("record-video-btn");
  const recordedVideo = document.getElementById("recorded-video");
  const photoBtn = document.getElementById("take-photo-btn");
  const canvas = document.getElementById("photo-canvas");
  const uploadBtn = document.getElementById("upload-btn");

  // カメラを取得
  const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  preview.srcObject = stream;

  let recordedBlob = null;
  let photoBlob = null;

  // 動画録画
  recordBtn.onclick = () => {
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type:"video/webm" });
      recordedVideo.src = URL.createObjectURL(recordedBlob);
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 8_000);
  };

  // 静止画取得
  photoBtn.onclick = () => {
    const ctx = canvas.getContext("2d");
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => { photoBlob = b; }, "image/png");
  };

  // ★保存＆アップロード
  uploadBtn.onclick = async () => {
    const form = new FormData();
    if (photoBlob) {
      form.append("media_type", "image");
      form.append("file", photoBlob, "photo.png");
      await fetch("/upload_media", { method:"POST", body:form });
    }
    if (recordedBlob) {
      const form2 = new FormData();
      form2.append("media_type", "video");
      form2.append("file", recordedBlob, "movie.webm");
      await fetch("/upload_media", { method:"POST", body:form2 });
    }
    alert("保存＆アップロードしました");
  };
})();
