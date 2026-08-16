"""Trim and peak-normalize generated PCM WAV effects for mobile playback."""

from __future__ import annotations

import argparse
import math
import wave
from pathlib import Path

import numpy as np


def master(source: Path, destination: Path) -> dict[str, float | int]:
    with wave.open(str(source), "rb") as wav:
        channels = wav.getnchannels()
        sample_rate = wav.getframerate()
        sample_width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())

    if sample_width != 2:
        raise ValueError(f"{source.name}: expected 16-bit PCM WAV")

    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32)
    samples = samples.reshape(-1, channels) / 32768.0
    envelope = np.max(np.abs(samples), axis=1)
    peak = float(envelope.max(initial=0.0))
    if peak <= 0:
        raise ValueError(f"{source.name}: audio is silent")

    # Retain a little air around the meaningful transient, but remove generator
    # padding that would make taps feel late in the game.
    threshold = max(10 ** (-52 / 20), peak * 0.003)
    active = np.flatnonzero(envelope >= threshold)
    pre_roll = round(sample_rate * 0.006)
    post_roll = round(sample_rate * 0.055)
    start = max(0, int(active[0]) - pre_roll)
    end = min(len(samples), int(active[-1]) + post_roll + 1)
    samples = samples[start:end]

    # Remove inaudible sub/DC energy that steals headroom on small speakers.
    cutoff_hz = 35.0
    rc = 1.0 / (2.0 * math.pi * cutoff_hz)
    dt = 1.0 / sample_rate
    alpha = rc / (rc + dt)
    filtered = np.zeros_like(samples)
    for channel in range(channels):
        previous_input = float(samples[0, channel])
        previous_output = 0.0
        for index in range(1, len(samples)):
            current = float(samples[index, channel])
            previous_output = alpha * (previous_output + current - previous_input)
            filtered[index, channel] = previous_output
            previous_input = current
    samples = filtered

    # Short equal-power fades prevent edge clicks without softening the attack.
    fade_in = min(len(samples), round(sample_rate * 0.003))
    fade_out = min(len(samples), round(sample_rate * 0.035))
    if fade_in:
        samples[:fade_in] *= np.sin(np.linspace(0, math.pi / 2, fade_in))[:, None]
    if fade_out:
        samples[-fade_out:] *= np.sin(np.linspace(math.pi / 2, 0, fade_out))[:, None]

    # Generated transient effects can have excellent peaks but disappear on a
    # phone speaker. Apply restrained compression only to unusually sparse files.
    current_peak = float(np.max(np.abs(samples)))
    current_rms = float(np.sqrt(np.mean(samples * samples)))
    crest_db = 20 * math.log10(max(current_peak, 1e-9) / max(current_rms, 1e-9))
    if crest_db > 16:
        magnitude = np.abs(samples)
        sign = np.sign(samples)
        threshold = 10 ** (-14 / 20)
        over = magnitude > threshold
        magnitude[over] = threshold * np.power(magnitude[over] / threshold, 1 / 2.2)
        samples = sign * magnitude

    target_peak = 10 ** (-1.0 / 20)
    mastered_peak = float(np.max(np.abs(samples)))
    samples *= target_peak / max(mastered_peak, 1e-9)
    pcm = np.clip(np.rint(samples * 32767), -32768, 32767).astype("<i2")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())

    rms = float(np.sqrt(np.mean(samples * samples)))
    return {
        "sample_rate": sample_rate,
        "channels": channels,
        "duration_ms": round(len(samples) * 1000 / sample_rate),
        "peak_dbfs": round(20 * math.log10(target_peak), 2),
        "rms_dbfs": round(20 * math.log10(max(rms, 1e-9)), 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    stats = master(args.source, args.destination)
    print(f"{args.destination}: {stats}")


if __name__ == "__main__":
    main()
