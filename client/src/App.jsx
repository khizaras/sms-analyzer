import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import AppShell from './components/AppShell';
import { FullScreenError, Splash } from './components/States';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Overview from './pages/Overview';
import Transactions from './pages/Transactions';
import Accounts from './pages/Accounts';
import Imports from './pages/Imports';
import Review from './pages/Review';
import Insights from './pages/Insights';
import Summary from './pages/Summary';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';
import { useGetMeQuery } from './store/api';
import { setUser } from './store/authSlice';
import { errText } from './utils/format';

function RequireAuth() {
  const token = useSelector((state) => state.auth.token);
  const dispatch = useDispatch();
  const { data, isLoading, isError, error, refetch } = useGetMeQuery(undefined, { skip: !token });
  useEffect(() => {
    if (data?.user) dispatch(setUser(data.user));
  }, [data, dispatch]);
  if (!token) return <Navigate to="/login" replace />;
  if (isLoading) return <Splash />;
  if (isError && error?.status === 401) return <Navigate to="/login" replace />;
  if (isError) {
    return (
      <FullScreenError
        title="The ledger cannot reach its database"
        text={errText(error)}
        onRetry={refetch}
      />
    );
  }
  return <AppShell />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="imports" element={<Imports />} />
        <Route path="review" element={<Review />} />
        <Route path="insights" element={<Insights />} />
        <Route path="summary" element={<Summary />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
