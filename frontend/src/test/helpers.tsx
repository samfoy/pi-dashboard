import React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { configureStore } from '@reduxjs/toolkit'
import dashboardReducer from '../store/dashboardSlice'
import chatReducer from '../store/chatSlice'
import notificationsReducer from '../store/notificationsSlice'
import type { RootState } from '../store'

/** Create a fresh Redux store, optionally with preloaded state. */
export function createTestStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: {
      dashboard: dashboardReducer,
      chat: chatReducer,
      notifications: notificationsReducer,
    },
    preloadedState: preloadedState as any,
  })
}

type TestStore = ReturnType<typeof createTestStore>

interface WrapperOptions extends Omit<RenderOptions, 'wrapper'> {
  store?: TestStore
  route?: string
}

/** Render with Redux Provider + MemoryRouter. */
export function renderWithProviders(
  ui: React.ReactElement,
  { store = createTestStore(), route = '/', ...renderOptions }: WrapperOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </Provider>
    )
  }
  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) }
}
