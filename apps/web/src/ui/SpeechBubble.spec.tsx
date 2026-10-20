import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import { SpeechBubble } from './SpeechBubble';

describe('SpeechBubble (mentor line, plan §9)', () => {
  it('renders the mentor line', () => {
    renderWithProviders(<SpeechBubble text="Fill the tank first, pilot." />);
    expect(screen.getByText('Fill the tank first, pilot.')).toBeInTheDocument();
    expect(document.querySelector('.speech-bubble')).not.toBeNull();
  });

  it('keeps an extra class from the caller', () => {
    renderWithProviders(<SpeechBubble text="Everyone drifts once." className="tutorial-bubble" />);
    expect(document.querySelector('.speech-bubble.tutorial-bubble')).not.toBeNull();
  });
});
