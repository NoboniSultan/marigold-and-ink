import { NavLink, Outlet } from 'react-router';
import { RequireAdmin } from '../../auth/RequireAdmin.tsx';
import styles from './Admin.module.css';

/**
 * The admin area (milestone 9): commissions (quotes, status, refunds), giving (tree
 * invoices), the monthly report, and the shop's products (milestone 12a). Loaded on demand, so visitors never download it.
 */
export function AdminLayout() {
  return (
    <RequireAdmin>
      <div className={styles.page}>
        <h1>Admin</h1>
        <nav aria-label="Admin" className={styles.subnav}>
          <NavLink to="/admin/commissions">Commissions</NavLink>
          <NavLink to="/admin/giving">Giving</NavLink>
          <NavLink to="/admin/report">Monthly report</NavLink>
          <NavLink to="/admin/shop">Shop</NavLink>
          <NavLink to="/admin/orders">Orders</NavLink>
        </nav>
        <Outlet />
      </div>
    </RequireAdmin>
  );
}
