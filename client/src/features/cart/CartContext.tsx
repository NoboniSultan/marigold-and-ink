/**
 * The shop cart (milestone 12b): only what was chosen (option and quantity), kept in this
 * browser's storage. Prices and stock are never stored here: the cart page asks the server
 * (POST /cart/preview), and checkout holds the stock. Storage can be unavailable (private
 * windows, blocked site data), so every read and write is guarded and the cart then simply
 * lasts for this visit. Other tabs pick up changes through the `storage` event.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CartLine } from '@shared/types/order.ts';

const KEY = 'marigold-cart-v1';
/** At most this many of one item (the server checks too). */
export const MAX_QUANTITY = 100;

function isLine(value: unknown): value is CartLine {
  const line = value as CartLine;
  return (
    Number.isSafeInteger(line?.variantId) &&
    line.variantId > 0 &&
    Number.isSafeInteger(line.quantity) &&
    line.quantity > 0
  );
}

function read(): CartLine[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    return [];
  }
}

function write(lines: CartLine[]) {
  try {
    if (lines.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Storage is unavailable: the cart lasts for this visit only.
  }
}

interface CartValue {
  lines: CartLine[];
  /** How many items in all. */
  count: number;
  add: (variantId: number, quantity: number) => void;
  setQuantity: (variantId: number, quantity: number) => void;
  remove: (variantIds: number[]) => void;
  clear: () => void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(read);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) setLines(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((change: (current: CartLine[]) => CartLine[]) => {
    setLines((current) => {
      const next = change(current);
      write(next);
      return next;
    });
  }, []);

  // The actions depend only on `update`, so they keep their identity as the cart changes
  // (an effect can depend on them without running again on every change).
  const add = useCallback(
    (variantId: number, quantity: number) =>
      update((current) => {
        const existing = current.find((l) => l.variantId === variantId);
        if (!existing) {
          return [...current, { variantId, quantity: Math.min(MAX_QUANTITY, quantity) }];
        }
        return current.map((l) =>
          l.variantId === variantId
            ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + quantity) }
            : l,
        );
      }),
    [update],
  );
  const setQuantity = useCallback(
    (variantId: number, quantity: number) =>
      update((current) =>
        current.map((l) =>
          l.variantId === variantId
            ? { ...l, quantity: Math.max(1, Math.min(MAX_QUANTITY, quantity)) }
            : l,
        ),
      ),
    [update],
  );
  const remove = useCallback(
    (variantIds: number[]) =>
      update((current) => {
        const next = current.filter((l) => !variantIds.includes(l.variantId));
        return next.length === current.length ? current : next;
      }),
    [update],
  );
  const clear = useCallback(() => update((current) => (current.length ? [] : current)), [update]);

  const value = useMemo<CartValue>(
    () => ({
      lines,
      count: lines.reduce((sum, l) => sum + l.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
    }),
    [lines, add, setQuantity, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}
