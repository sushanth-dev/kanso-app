import { queryOptions, QueryClient } from '@tanstack/react-query';
import { accountApi } from './api/account-api.ts';

export const ME_QUERY_KEY = ['me'] as const;
export const meQueryOptions = () =>
  queryOptions({
    queryKey: ME_QUERY_KEY,
    queryFn: () => accountApi.getMe(),
    retry: false,
    staleTime: 30_000,
  });
export const queryClient = new QueryClient();
