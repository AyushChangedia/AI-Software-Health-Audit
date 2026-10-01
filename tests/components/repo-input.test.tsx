/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoInput } from '@/components/landing/repo-input';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

describe('RepoInput', () => {
  beforeEach(() => {
    push.mockReset();
    vi.restoreAllMocks();
  });

  it('explains the public/private distinction before anything is typed', () => {
    render(<RepoInput />);
    expect(screen.getByText(/Public repositories analyse instantly/i)).toBeTruthy();
  });

  it('confirms a valid repository as the user types', async () => {
    const user = userEvent.setup();
    render(<RepoInput />);
    await user.type(screen.getByLabelText(/GitHub repository URL/i), 'github.com/acme/app');
    await waitFor(() => {
      expect(screen.getByText(/GitHub repository detected/i)).toBeTruthy();
    });
  });

  it('explains why an input is rejected', async () => {
    const user = userEvent.setup();
    render(<RepoInput />);
    await user.type(screen.getByLabelText(/GitHub repository URL/i), 'https://gitlab.com/a/b');
    await waitFor(() => {
      expect(screen.getByText(/not supported yet/i)).toBeTruthy();
    });
  });

  it('marks the field invalid for assistive technology', async () => {
    const user = userEvent.setup();
    render(<RepoInput />);
    const input = screen.getByLabelText(/GitHub repository URL/i);
    await user.type(input, 'https://gitlab.com/a/b');
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
  });

  it('does not submit an invalid URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    render(<RepoInput />);
    await user.type(screen.getByLabelText(/GitHub repository URL/i), 'nonsense');
    await user.click(screen.getByRole('button', { name: /Analyse repository/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('navigates to the scan once one is queued', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ scan: { id: 'scn_abc' } }), { status: 202 }),
    );
    const user = userEvent.setup();
    render(<RepoInput />);
    await user.type(screen.getByLabelText(/GitHub repository URL/i), 'github.com/acme/app');
    await user.click(screen.getByRole('button', { name: /Analyse repository/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/scan/scn_abc'));
  });

  it('surfaces a server error with its hint rather than failing silently', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'rate_limited',
            message: 'GitHub rate limit reached.',
            hint: 'Try again in about 14 minutes.',
            retryable: true,
          },
        }),
        { status: 429 },
      ),
    );
    const user = userEvent.setup();
    render(<RepoInput />);
    await user.type(screen.getByLabelText(/GitHub repository URL/i), 'github.com/acme/app');
    await user.click(screen.getByRole('button', { name: /Analyse repository/i }));

    await waitFor(() => {
      expect(screen.getByText(/GitHub rate limit reached/i)).toBeTruthy();
      expect(screen.getByText(/about 14 minutes/i)).toBeTruthy();
    });
  });

  it('reports a network failure instead of hanging', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<RepoInput />);
    await user.type(screen.getByLabelText(/GitHub repository URL/i), 'github.com/acme/app');
    await user.click(screen.getByRole('button', { name: /Analyse repository/i }));
    await waitFor(() => {
      expect(screen.getByText(/Could not reach Sentinel/i)).toBeTruthy();
    });
  });

  it('always offers the demo path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ scan: { id: 'scn_demo' } }), { status: 202 }),
    );
    const user = userEvent.setup();
    render(<RepoInput />);
    await user.click(screen.getByRole('button', { name: /Run the demo analysis/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/scan/scn_demo'));
  });
});
