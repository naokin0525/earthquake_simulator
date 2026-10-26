import type { JmaIntensityScale } from '../types';

export const JMA_INTENSITY_LEVELS: ReadonlyArray<{
  scale: JmaIntensityScale;
  colour: string;
  label: string;
}> = [
  { scale: '0', colour: '#FFFFFF', label: '0' },
  { scale: '1', colour: '#68C1F9', label: '1' },
  { scale: '2', colour: '#C6F4CD', label: '2' },
  { scale: '3', colour: '#FDEF72', label: '3' },
  { scale: '4', colour: '#F6C344', label: '4' },
  { scale: '5-', colour: '#E89939', label: '5-' },
  { scale: '5+', colour: '#DF742C', label: '5+' },
  { scale: '6-', colour: '#EA4225', label: '6-' },
  { scale: '6+', colour: '#971E27', label: '6+' },
  { scale: '7', colour: '#B825F7', label: '7' }
];

export const LPGM_INTENSITY_LEVELS: ReadonlyArray<{
  classLevel: number;
  colour: string;
  label: string;
}> = [
  { classLevel: 1, colour: '#68C1F9', label: 'Class 1' },
  { classLevel: 2, colour: '#F6C344', label: 'Class 2' },
  { classLevel: 3, colour: '#EA4225', label: 'Class 3' },
  { classLevel: 4, colour: '#B825F7', label: 'Class 4' }
];

export function hexToRgba(colour: string, alpha = 255): [number, number, number, number] {
  const hex = colour.slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    alpha
  ];
}
