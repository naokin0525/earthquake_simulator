/**
 * src/utils/audioAlert.ts
 * =====================
 * Procedural audio synthesizer for JMA earthquake alerts using Web Audio API.
 */

export class AudioAlertSystem {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isSpeechEnabled: boolean = false;

  constructor() {
    this.isMuted = localStorage.getItem('sim_audio_muted') === 'true';
    this.isSpeechEnabled = localStorage.getItem('sim_speech_enabled') === 'true';
  }

  private initCtx() {
    if (!this.ctx) {
      // Lazily create the AudioContext when needed to avoid autoplay restrictions
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Some browsers start the context in a suspended state; resume if needed.
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Set mute state and persist it.
   */
  public setMute(muted: boolean): void {
    this.isMuted = muted;
    localStorage.setItem('sim_audio_muted', String(muted));
    if (muted && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Retrieve the current mute flag.
   */
  public getMuted(): boolean {
    return this.isMuted;
  }

  public setSpeechEnabled(enabled: boolean): void {
    this.isSpeechEnabled = enabled;
    localStorage.setItem('sim_speech_enabled', String(enabled));
    if (!enabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  public getSpeechEnabled(): boolean {
    return this.isSpeechEnabled;
  }

  public canSpeak(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  public speak(text: string): void {
    if (this.isMuted || !this.isSpeechEnabled || !this.canSpeak()) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 1;

    const japaneseVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('ja'));
    if (japaneseVoice) utterance.voice = japaneseVoice;

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  /**
   * Plays the distinctive EEW Warning chime.
   * Consists of a dual‑frequency rising arpeggio with an envelope decay.
   */
  public playEewWarningChime(): void {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Frequencies for the chime (simplified JMA style)
    const freqs = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5

    freqs.forEach((freq, i) => {
      const ctx = this.ctx!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.15);

      // Simple envelope: quick attack, short decay
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
   * (Currently disabled per user requirement.)
   */
  public playStationPing(): void {
    // No‑op: the audio for station triggers is intentionally disabled.
    return;
  }
}

export const audioAlertSystem = new AudioAlertSystem();