import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './components/Login.jsx'
import Register from './components/Register.jsx'
import Dashboard from './components/Dashboard.jsx'
import Orders from './components/Orders.jsx'
import Tracking from './components/Tracking.jsx'
import ShippingSimulator from './components/ShippingSimulator.jsx'
import { useAuth } from './contexts/AuthContext.jsx'

function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route 
          path="/login" 
          element={user ? <Navigate to="/dashboard" /> : <Login />} 
        />
        <Route
          path="/register"
          element={user ? <Navigate to="/dashboard" /> : <Register />}
        />
        <Route 
          path="/dashboard" 
          element={user ? <Dashboard /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/orders" 
          element={user ? <Orders /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/tracking/:orderId" 
          element={<Tracking />} 
        />
        <Route 
          path="/simulator" 
          element={<ShippingSimulator />} 
        />
        <Route 
          path="/" 
          element={user ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} 
        />
      </Routes>
    </div>
  )
}

export default App
