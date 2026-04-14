import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import dashboardReducer from './dashboardSlice'
import notificationsReducer from './notificationsSlice'
import chatReducer from './chatSlice'

export const store = configureStore({
  reducer: {
    dashboard: dashboardReducer,
    notifications: notificationsReducer,
    chat: chatReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
