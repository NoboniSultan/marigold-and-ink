/** Files on the site (milestone 10): the client's commission page, the request form, and the admin. */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommissionFile, FilesMeta } from '@shared/types/files.ts';
import type { Call, MockResponse } from '../../test/utils.tsx';
import { USER, mockApi, renderRoute } from '../../test/utils.tsx';

const META: FilesMeta = {
  filesEnabled: true,
  referencesOpen: true,
  referenceLimit: 10,
  referenceMaxBytes: 15 * 1024 * 1024,
  previewMaxBytes: 25 * 1024 * 1024,
  finalMaxBytes: 100 * 1024 * 1024,
};

const file = (
  id: number,
  kind: CommissionFile['kind'],
  name: string,
  extra: Partial<CommissionFile> = {},
): CommissionFile => ({
  id,
  kind,
  originalFilename: name,
  contentType: kind === 'final' ? 'application/pdf' : 'image/jpeg',
  sizeBytes: 200_000,
  width: kind === 'final' ? null : 800,
  height: kind === 'final' ? null : 600,
  createdAt: '2026-11-24T12:00:00.000Z',
  url: kind === 'final' ? null : `https://storage.test/${id}`,
  downloadUrl: `https://storage.test/${id}?download`,
  deleteAfter: null,
  ...extra,
});

const COMMISSION = {
  id: 7,
  clientId: USER.id,
  size: 'A3',
  medium: 'ink',
  subjectCount: 1,
  fulfillmentType: 'digital',
  isRush: false,
  notes: null,
  status: 'inquiry',
  revisionCount: 0,
  revisionLimit: 2,
  quotedTotalCents: null,
  depositCents: null,
  balanceCents: null,
  createdAt: '2026-11-24T12:00:00.000Z',
  updatedAt: '2026-11-24T12:00:00.000Z',
  availableTransitions: ['canceled'],
};

function api({
  user = USER as typeof USER,
  commission = COMMISSION as typeof COMMISSION,
  files = [] as CommissionFile[],
  meta = META,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return { body: { data: user } };
    if (call.path === `/commissions/${commission.id}`) return { body: { data: commission } };
    if (call.path === `/commissions/${commission.id}/payments`) {
      return { body: { data: [], meta: { paymentsEnabled: true, currency: 'usd' } } };
    }
    if (call.path === `/commissions/${commission.id}/files` && call.method === 'GET') {
      return { body: { data: files, meta } };
    }
    if (call.path === '/auth/providers')
      return { body: { data: { google: true, emailSignup: true } } };
    return undefined;
  });
}

const photo = (name: string, bytes = 1000) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });

describe("the client's commission page", () => {
  it('uploads reference photos one at a time, with their names, and shows the count', async () => {
    const user = userEvent.setup();
    const calls = api({
      files: [file(1, 'reference', 'Benito.jpg')],
      extra: (call) =>
        call.path === '/commissions/7/files/references'
          ? { status: 201, body: { data: file(2, 'reference', 'Sofa.jpg') } }
          : undefined,
    });
    renderRoute('/commissions/7');

    const list = await screen.findByRole('list', { name: 'Reference photos' });
    expect(within(list).getByRole('img', { name: 'Benito.jpg' })).toHaveAttribute(
      'src',
      'https://storage.test/1',
    );
    expect(screen.getByText(/1 of 10/)).toBeInTheDocument();

    await user.upload(screen.getByLabelText('Add reference photos'), [
      photo('Sofa.jpg'),
      photo('Garden photo.jpg'),
    ]);

    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    const [first] = calls.filter((c) => c.method === 'POST');
    expect(first!.headers.get('X-Filename')).toBe('Sofa.jpg');
    expect(first!.headers.get('Content-Type')).toBe('image/jpeg');
    expect(first!.body).toBeInstanceOf(File);
    const second = calls.filter((c) => c.method === 'POST')[1]!;
    expect(second.headers.get('X-Filename')).toBe('Garden%20photo.jpg');
  });

  it('refuses a photo over the limit before uploading it, and shows server refusals', async () => {
    const user = userEvent.setup();
    const calls = api({
      extra: (call) =>
        call.path === '/commissions/7/files/references'
          ? {
              status: 400,
              body: {
                error: { code: 'NOT_AN_IMAGE', message: "That file couldn't be read as an image" },
              },
            }
          : undefined,
    });
    renderRoute('/commissions/7');

    await user.upload(await screen.findByLabelText('Add reference photos'), [
      photo('huge.jpg', 16 * 1024 * 1024),
      photo('broken.jpg'),
    ]);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('huge.jpg: too large (the limit is 15.0 MB)');
    expect(alert).toHaveTextContent("broken.jpg: That file couldn't be read as an image");
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('removes a photo while that is still allowed', async () => {
    const user = userEvent.setup();
    const calls = api({
      files: [file(1, 'reference', 'Benito.jpg')],
      extra: (call) => (call.method === 'DELETE' ? { status: 204 } : undefined),
    });
    renderRoute('/commissions/7');

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/commissions/7/files/1')).toBe(
        true,
      ),
    );
  });

  it('shows previews, the final download with how long it stays, and locks photos once work starts', async () => {
    api({
      commission: { ...COMMISSION, status: 'delivered', availableTransitions: [] },
      meta: { ...META, referencesOpen: false },
      files: [
        file(1, 'reference', 'Benito.jpg'),
        file(2, 'preview', 'wip.png'),
        file(3, 'final', 'Benito.pdf', { deleteAfter: '2027-11-24T12:00:00.000Z' }),
      ],
    });
    renderRoute('/commissions/7');

    expect(await screen.findByRole('img', { name: 'Preview: wip.png' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download Benito\.pdf/ })).toHaveAttribute(
      'href',
      'https://storage.test/3?download',
    );
    expect(screen.getByText('Available until November 24, 2027.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add reference photos')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.getByText(/can be changed until work starts/)).toBeInTheDocument();
  });

  it('shows nothing about files while uploads are off', async () => {
    api({ meta: { ...META, filesEnabled: false } });
    renderRoute('/commissions/7');

    expect(await screen.findByText(/Request received/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Reference photos' })).not.toBeInTheDocument();
  });
});

describe('the admin commission page', () => {
  const ADMIN = { ...USER, id: 1, role: 'admin' as const };

  it('uploads previews and final files, and deletes after confirming', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = api({
      user: ADMIN,
      files: [file(1, 'reference', 'Benito.jpg'), file(3, 'final', 'old.pdf')],
      extra: (call) => {
        if (call.path === '/admin/commissions/7') {
          return {
            body: {
              data: {
                commission: { ...COMMISSION, status: 'in_progress', availableTransitions: [] },
                client: { id: USER.id, displayName: 'Ana', email: 'ana@example.com' },
                money: {
                  paidCents: 0,
                  refundedCents: 0,
                  withheldForTreesCents: 0,
                  refundableCents: 0,
                  treeMoneyRefundedCents: 0,
                  trees: null,
                },
              },
            },
          };
        }
        if (call.path === '/commissions/7/quote')
          return { status: 404, body: { error: { code: 'QUOTE_NOT_FOUND', message: 'No quote' } } };
        if (call.path.startsWith('/admin/commissions/7/files/'))
          return { status: 201, body: { data: file(9, 'preview', 'x.png') } };
        if (call.method === 'DELETE') return { status: 204 };
        return undefined;
      },
    });
    renderRoute('/admin/commissions/7');

    await user.upload(await screen.findByLabelText('Add previews'), photo('wip.png'));
    await user.upload(
      screen.getByLabelText('Add final files'),
      new File(['%PDF-'], 'Benito.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
        '/admin/commissions/7/files/previews',
        '/admin/commissions/7/files/finals',
      ]),
    );

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[1]!);
    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/commissions/7/files/3')).toBe(
        true,
      ),
    );
  });
});

describe('the request form', () => {
  it('offers reference photos right after the request is sent', async () => {
    const user = userEvent.setup();
    api({
      extra: (call) => {
        if (call.path === '/pricing/options') {
          return {
            body: {
              data: {
                combinations: [{ size: 'A3', medium: 'ink' }],
                fulfillmentTypes: ['digital'],
                multipleSubjects: false,
                rushAvailable: false,
              },
            },
          };
        }
        if (call.path === '/commissions' && call.method === 'POST')
          return { status: 201, body: { data: COMMISSION } };
        return undefined;
      },
    });
    renderRoute('/commission');

    await user.click(await screen.findByRole('button', { name: /send|request/i }));

    expect(
      await screen.findByRole('heading', { name: 'Add reference photos (optional)' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Add reference photos')).toBeInTheDocument();
  });
});
