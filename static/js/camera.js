let currentStream = null;
let recordedBlob = null;
let photoBlob = null;
let recordMime = "video/webm";

(async () => {
  const preview        = document.getElementById("preview");
  const recordBtn      = document.getElementById("record-video-btn");
  const recordedVideo  = document.getElementById("recorded-video");
  const photoBtn       = document.getElementById("take-photo-btn");
  const canvas         = document.getElementById("photo-canvas");
  const uploadBtn      = document.getElementById("upload-btn");

  // ===== カメラ起動関数（前面／背面切替用） =====
  async function startCamera(mode = "environment") {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }
    const constraints = {
      video: {
        facingMode: (mode === "environment")
          ? { exact: "environment" }
          : "user"
      },
      audio: true
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStream = stream;
      preview.srcObject = stream;
    } catch (err) {
      console.error("カメラ起動エラー:", err);
      alert("カメラが起動できません: " + err.message);
    }
  }

  // ページロード時は背面カメラで起動
  startCamera("environment");

  // 切替ボタン処理
  document.getElementById("front-btn").onclick = () => startCamera("user");
  document.getElementById("back-btn").onclick  = () => startCamera("environment");

  // ===== 動画録画 =====
  recordBtn.onclick = () => {
    if (!currentStream) {
      alert("カメラが起動していません");
      return;
    }
    let options = { mimeType: "video/mp4" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
    }
    recordMime = options.mimeType;

    const recorder = new MediaRecorder(currentStream, options);
    const chunks   = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: recordMime });
      recordedVideo.src = URL.createObjectURL(recordedBlob);
      recordedVideo.controls = true;
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 8_000);  // 8秒録画
  };

  // ===== 静止画取得 =====
  photoBtn.onclick = () => {
    if (!currentStream) {
      alert("カメラが起動していません");
      return;
    }
    const ctx = canvas.getContext("2d");
    ctx.drawImage(preview, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => { photoBlob = b; }, "image/png");
  };

  // ===== 保存＆アップロード =====
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
