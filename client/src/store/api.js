import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { logout } from './authSlice';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: '/api',
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});

let resetCache = () => ({ type: 'ledgersms/reset-cache' });

const baseQuery = async (args, api, extra) => {
  const result = await rawBaseQuery(args, api, extra);
  const url = typeof args === 'string' ? args : args?.url || '';
  const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/signup');
  if (result.error && result.error.status === 401 && !isAuthAttempt) {
    api.dispatch(logout());
    api.dispatch(resetCache());
  }
  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Me', 'Stats', 'Txn', 'Account', 'Import', 'Review', 'Insight', 'Meta', 'Summary'],
  endpoints: (build) => ({
    login: build.mutation({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
    signup: build.mutation({
      query: (body) => ({ url: '/auth/signup', method: 'POST', body }),
    }),
    getMe: build.query({
      query: () => '/auth/me',
      providesTags: ['Me'],
    }),
    updateProfile: build.mutation({
      query: (body) => ({ url: '/auth/profile', method: 'PUT', body }),
      invalidatesTags: ['Me'],
    }),
    changePassword: build.mutation({
      query: (body) => ({ url: '/auth/password', method: 'PUT', body }),
    }),
    getOverview: build.query({
      query: ({ from, to }) => ({ url: '/stats/overview', params: { from, to } }),
      providesTags: ['Stats'],
    }),
    getTransactions: build.query({
      query: (params) => ({ url: '/transactions', params }),
      providesTags: ['Txn'],
    }),
    updateCategory: build.mutation({
      query: ({ id, category }) => ({ url: `/transactions/${id}`, method: 'PATCH', body: { category } }),
      invalidatesTags: ['Txn', 'Stats'],
    }),
    getAccounts: build.query({
      query: () => '/accounts',
      providesTags: ['Account'],
    }),
    getImports: build.query({
      query: (params) => ({ url: '/imports', params }),
      providesTags: ['Import'],
    }),
    uploadImport: build.mutation({
      query: (file) => {
        const body = new FormData();
        body.append('file', file);
        return { url: '/imports', method: 'POST', body };
      },
      invalidatesTags: ['Import', 'Stats', 'Txn', 'Account', 'Review', 'Meta'],
    }),
    getReview: build.query({
      query: (params) => ({ url: '/review', params }),
      providesTags: ['Review'],
    }),
    classifyMessage: build.mutation({
      query: ({ id, ...body }) => ({ url: `/review/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Review', 'Txn', 'Stats', 'Account', 'Meta'],
    }),
    getMeta: build.query({
      query: () => '/meta',
      providesTags: ['Meta'],
    }),
    getInsights: build.query({
      query: ({ from, to }) => ({ url: '/insights', params: { from, to } }),
      providesTags: ['Insight'],
    }),
    createSummary: build.mutation({
      query: (body) => ({ url: '/insights/summary', method: 'POST', body }),
      invalidatesTags: ['Insight'],
    }),
    explainTransaction: build.mutation({
      query: (body) => ({ url: '/insights/explain', method: 'POST', body }),
    }),
    analyzeTransaction: build.mutation({
      query: (id) => ({ url: `/transactions/${id}/analyze`, method: 'POST' }),
      invalidatesTags: ['Txn'],
    }),
    analyzeTransactions: build.mutation({
      query: (ids) => ({ url: '/transactions/analyze', method: 'POST', body: { ids } }),
      invalidatesTags: ['Txn'],
    }),
    analyzeFiltered: build.mutation({
      query: (body) => ({ url: '/transactions/analyze-filtered', method: 'POST', body }),
      invalidatesTags: ['Txn'],
    }),
    suggestMessage: build.mutation({
      query: (id) => ({ url: `/review/${id}/suggest`, method: 'POST' }),
      invalidatesTags: ['Review'],
    }),
    suggestMessages: build.mutation({
      query: (ids) => ({ url: '/review/suggest', method: 'POST', body: { ids } }),
      invalidatesTags: ['Review'],
    }),
    acceptSuggestion: build.mutation({
      query: (id) => ({ url: `/review/${id}/accept`, method: 'POST' }),
      invalidatesTags: ['Review', 'Txn', 'Stats', 'Account', 'Summary'],
    }),
    getSummary: build.query({
      query: ({ from, to }) => ({ url: '/stats/summary', params: { from, to } }),
      providesTags: ['Summary'],
    }),
    writeSummary: build.mutation({
      query: (body) => ({ url: '/stats/summary/narrative', method: 'POST', body }),
      invalidatesTags: ['Summary'],
    }),
    getHealth: build.query({
      query: () => '/health',
    }),
  }),
});

resetCache = () => api.util.resetApiState();

export const {
  useLoginMutation,
  useSignupMutation,
  useGetMeQuery,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useGetOverviewQuery,
  useGetTransactionsQuery,
  useUpdateCategoryMutation,
  useGetAccountsQuery,
  useGetImportsQuery,
  useUploadImportMutation,
  useGetReviewQuery,
  useClassifyMessageMutation,
  useGetMetaQuery,
  useGetInsightsQuery,
  useCreateSummaryMutation,
  useExplainTransactionMutation,
  useAnalyzeTransactionMutation,
  useAnalyzeTransactionsMutation,
  useAnalyzeFilteredMutation,
  useSuggestMessageMutation,
  useSuggestMessagesMutation,
  useAcceptSuggestionMutation,
  useGetSummaryQuery,
  useWriteSummaryMutation,
  useGetHealthQuery,
} = api;
