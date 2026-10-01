/**
 * src/utils/audioAlert.ts
 * =====================
 * Procedural audio synthesizer for JMA earthquake alerts using Web Audio API.
 */
export class AudioAlertSystem {
    ctx = null;
    isMuted = false;
    constructor() {
        this.isMuted = localStorage.getItem('sim_audio_muted') === 'true';
    }
    initCtx() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }
    setMute(muted) {
        this.isMuted = muted;
        localStorage.setItem('sim_audio_muted', String(muted));
    }
    getMuted() {
        return this.isMuted;
    }
    /**
     * Plays the distinctive EEW Warning chime.
     * Consists of a dual-frequency rising arpeggio with an envelope decay.
     */
    playEewWarningChime() {
        if (this.isMuted)
            return;
        this.initCtx();
        if (!this.ctx)
            return;
        const now = this.ctx.currentTime;
        // Frequencies for the chime (simplified JMA style)
        const freqs = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
        freqs.forEach((freq, i) => {
            const ctx = this.ctx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.15);
            gain.gain.setValueAtTime(0, now + i * 0.15);
            gain.gain.linearRampToValueAtTime(0.2, now + i * 0.15 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.15);
            osc.stop(now + i * 0.15 + 0.5);
        });
    }
    /**
     * Plays a subtle ping when a station is triggered.
     * (Disabled per user requirement)
     */
    playStationPing() {
        return;
    }
}
export const audioAlertSystem = new AudioAlertSystem();
