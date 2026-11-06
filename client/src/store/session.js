import { api } from './api';
import { logout, setCredentials } from './authSlice';

export function beginSession(dispatch, payload) {
  dispatch(api.util.resetApiState());
  dispatch(setCredentials(payload));
}

export function endSession(dispatch) {
  dispatch(logout());
  dispatch(api.util.resetApiState());
}
