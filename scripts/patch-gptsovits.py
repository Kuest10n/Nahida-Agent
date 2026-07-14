import os

tts_path = 'e:/GSV/GPT-SoVITS/GPT_SoVITS/TTS_infer_pack/TTS.py'

with open(tts_path, 'r', encoding='utf-8') as f:
    content = f.read()

old_marker = 'def _get_ref_spec(self, ref_audio_path):'
new_code = '''    def _get_ref_spec(self, ref_audio_path):
        ffmpeg_path = \"F:/Live2D Cubism 4.1/tools/ffmpeg/ffmpeg.exe\"
        if not os.path.exists(ffmpeg_path):
            ffmpeg_path = \"ffmpeg\"
        try:
            out, _ = (
                ffmpeg.input(ref_audio_path, threads=0)
                .output(\"-\", format=\"f32le\", acodec=\"pcm_f32le\", ac=1, ar=self.configs.sampling_rate)
                .run(cmd=[ffmpeg_path, \"-nostdin\"], capture_stdout=True, capture_stderr=True)
            )
            audio_np = np.frombuffer(out, np.float32).flatten()
            audio = torch.from_numpy(audio_np).unsqueeze(0).to(self.configs.device).float()
            raw_sr = self.configs.sampling_rate
            raw_audio = audio
        except Exception:
            raw_audio, raw_sr = torchaudio.load(ref_audio_path)
            raw_audio = raw_audio.to(self.configs.device).float()
            if raw_sr != self.configs.sampling_rate:
                audio = raw_audio.to(self.configs.device)
                if audio.shape[0] == 2:
                    audio = audio.mean(0).unsqueeze(0)
                audio = resample(audio, raw_sr, self.configs.sampling_rate, self.configs.device)
            else:
                audio = raw_audio.to(self.configs.device)
                if audio.shape[0] == 2:
                    audio = audio.mean(0).unsqueeze(0)

        self.prompt_cache[\"raw_audio\"] = raw_audio
        self.prompt_cache[\"raw_sr\"] = raw_sr

        maxx = audio.abs().max()
        if maxx > 1:
            audio /= min(2, maxx)'''

lines = content.split('\n')
result = []
i = 0
while i < len(lines):
    if old_marker in lines[i]:
        result.append(new_code)
        i += 1
        while i < len(lines) and (lines[i].startswith('        ') or lines[i].startswith('    ')):
            i += 1
        continue
    result.append(lines[i])
    i += 1

content = '\n'.join(result)

with open(tts_path, 'w', encoding='utf-8') as f:
    f.write(content)

print('File modified successfully!')