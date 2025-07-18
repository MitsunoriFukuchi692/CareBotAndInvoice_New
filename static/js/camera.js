(async () => {
  const video = document.getElementById("video");
  const recordBtn = document.getElementById("record-btn");
  const recorded = document.getElementById("recorded");
  const snapBtn = document.getElementById("snap-btn");
  const snapshot = document.getElementById("snapshot");

  // カメラ映像を取得
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
  } catch (err) {
    console.error("カメラアクセスに失敗:", err);
    alert("カメラへのアクセスが許可されませんでした。");
    return;
  }

  // ① 10秒間動画録画
  recordBtn.addEventListener("click", () => {
    if (!stream) return;
    const mediaRecorder = new MediaRecorder(stream);
    let chunks = [];
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      recorded.src = URL.createObjectURL(blob);
      recorded.style.display = "block";
      chunks = [];
    };
    mediaRecorder.start();
    recordBtn.disabled = true;
    setTimeout(() => {
      mediaRecorder.stop();
      recordBtn.disabled = false;
    }, 10000); // 10秒
  });

  // ② 写真撮影
  snapBtn.addEventListener("click", () => {
    if (!stream) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    snapshot.src = canvas.toDataURL("image/png");
    snapshot.style.display = "block";
  });
})();
