(async () => {
  const video = document.getElementById("video");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("このブラウザはカメラに対応していません。");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
  } catch (err) {
    console.error("カメラアクセスに失敗:", err);
    alert("カメラへのアクセスが許可されませんでした。");
  }
})();
