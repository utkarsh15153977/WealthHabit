import { createElement, Suspense, type ComponentType } from 'react';
import { Loading } from './Loading';

export const WithSuspense = (Component: ComponentType) => () => (
  <Suspense fallback={createElement(Loading)}>
    <Component />
  </Suspense>
);
