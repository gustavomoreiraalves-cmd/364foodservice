'use client';
import { useEffect, useRef, useState } from 'react';

const ZOOM_FATOR = 2;

// Liga a câmera frontal e entrega a fonte de imagem pronta via onVideoPronto(fonte).
// A fonte é o <video> quando o hardware suporta zoom nativo (applyConstraints),
// ou um <canvas> com crop central (zoom digital) quando não suporta.
// O chamador roda seu próprio loop de detecção sobre a fonte recebida.
export default function CameraCapture({ onVideoPronto, onErro, className }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [zoomDigital, setZoomDigital] = useState(false);

  useEffect(() => {
    let ativo = true;

    function iniciarZoomDigital(video) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      let avisado = false;
      function desenhar() {
        if (!ativo) return;
        const w = video.videoWidth, h = video.videoHeight;
        if (w && h) {
          canvas.width = w;
          canvas.height = h;
          const cw = w / ZOOM_FATOR, ch = h / ZOOM_FATOR;
          const sx = (w - cw) / 2, sy = (h - ch) / 2;
          ctx.drawImage(video, sx, sy, cw, ch, 0, 0, w, h);
          if (!avisado) { avisado = true; onVideoPronto?.(canvas); }
        }
        rafRef.current = requestAnimationFrame(desenhar);
      }
      desenhar();
    }

    async function ligar() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (!ativo) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        if (!ativo) return;

        let zoomNativoOk = false;
        try {
          const [track] = stream.getVideoTracks();
          const caps = track.getCapabilities?.();
          if (caps?.zoom) {
            const alvo = Math.min(ZOOM_FATOR, caps.zoom.max);
            await track.applyConstraints({ advanced: [{ zoom: alvo }] });
            zoomNativoOk = true;
          }
        } catch { /* sem suporte a zoom nativo: cai no fallback digital */ }

        if (!ativo) return;
        if (zoomNativoOk) {
          onVideoPronto?.(video);
        } else {
          setZoomDigital(true);
          iniciarZoomDigital(video);
        }
      } catch (err) {
        onErro?.('Não foi possível acessar a câmera: ' + err.message);
      }
    }

    ligar();
    return () => {
      ativo = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <>
      <video ref={videoRef} muted playsInline className={zoomDigital ? undefined : className}
        style={zoomDigital ? { display: 'none' } : undefined} />
      <canvas ref={canvasRef} className={zoomDigital ? className : undefined}
        style={zoomDigital ? undefined : { display: 'none' }} />
    </>
  );
}
