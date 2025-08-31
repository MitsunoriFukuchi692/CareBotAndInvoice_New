from google.cloud import texttospeech
from google.oauth2 import service_account

creds = service_account.Credentials.from_service_account_file(
    r"C:\Users\mfuku\Documents\gcp_keys\google-credentials.json"
)

client = texttospeech.TextToSpeechClient(credentials=creds)

synthesis_input = texttospeech.SynthesisInput(text="Xin chào, tôi là Mima-kun. Tôi nói tiếng Việt!")

voice = texttospeech.VoiceSelectionParams(
    language_code="vi-VN",
    name="vi-VN-Wavenet-A"  # 一覧に出た好きな声を選べます
)

audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)

response = client.synthesize_speech(
    input=synthesis_input, voice=voice, audio_config=audio_config
)

with open("output.mp3", "wb") as out:
    out.write(response.audio_content)

print("音声ファイル output.mp3 を作成しました！")
