import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Breadcrumb, Button, Dropdown } from 'antd';
import {
  AppstoreOutlined,
  BankOutlined,
  BulbOutlined,
  FundOutlined,
  CloudUploadOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  SwapOutlined,
  AlertOutlined,
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import Logo from './Logo';
import { endSession } from '../store/session';
import { initials } from '../utils/format';

const NAV = [
  ['/overview', 'Overview', AppstoreOutlined],
  ['/transactions', 'Transactions', SwapOutlined],
  ['/accounts', 'Accounts', BankOutlined],
  ['/imports', 'Imports', CloudUploadOutlined],
  ['/review', 'Review', AlertOutlined],
  ['/insights', 'Insights', BulbOutlined],
  ['/summary', 'Summary', FundOutlined],
  ['/settings', 'Settings', SettingOutlined],
];

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user);
  const [collapsed, setCollapsed] = useState(localStorage.getItem('ledgersms_nav') === '1');
  const [navOpen, setNavOpen] = useState(false);
  const current = NAV.find(([path]) => location.pathname.startsWith(path));

  useEffect(() => {
    document.title = current ? `${current[1]} · LedgerSMS` : 'LedgerSMS';
    setNavOpen(false);
  }, [location.pathname, current]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('ledgersms_nav', next ? '1' : '0');
  };

  const menu = {
    items: [
      { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out' },
    ],
    onClick: ({ key }) => {
      if (key === 'settings') navigate('/settings');
      if (key === 'logout') {
        endSession(dispatch);
        navigate('/login');
      }
    },
  };

  return (
    <div className={`ls-shell${collapsed ? ' is-collapsed' : ''}${navOpen ? ' nav-open' : ''}`}>
      <button className="ls-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      <aside className="ls-sidebar">
        <div className="ls-side-top">
          <Logo linked light />
          <button className="ls-icon-btn" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleCollapsed}>
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </div>
        <nav className="ls-nav">
          {NAV.map(([path, label, Icon]) => (
            <NavLink key={path} to={path} title={label}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="ls-side-foot">
          <span className="ls-avatar">{initials(user?.name)}</span>
          <div className="ls-side-user">
            <strong>{user?.name || 'Member'}</strong>
            <small>{user?.email}</small>
          </div>
        </div>
      </aside>
      <div className="ls-main">
        <div className="ls-accent" />
        <header className="ls-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Button className="ls-menu-btn" icon={<MenuOutlined />} onClick={() => setNavOpen(true)} aria-label="Open menu" />
            <Breadcrumb items={[{ title: 'LedgerSMS' }, { title: current ? current[1] : 'Ledger' }]} />
          </div>
          <Dropdown menu={menu} trigger={['click']}>
            <Button type="text" style={{ height: 42 }}>
              <Avatar size={28} style={{ background: '#0f6e56' }}>{initials(user?.name)}</Avatar>
              <span style={{ marginLeft: 8 }}>{user?.name?.split(' ')[0] || 'You'}</span>
            </Button>
          </Dropdown>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
