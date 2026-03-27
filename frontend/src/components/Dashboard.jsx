import React from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import Navigation from './Navigation.jsx'
import SimulatorBanner from './SimulatorBanner.jsx'
import { Package, Users, Truck, BarChart3 } from 'lucide-react'

function Dashboard() {
  const { user, logout } = useAuth()

  const getRoleColor = (role) => {
    switch (role) {
      case 'admin': return 'bg-purple-100 text-purple-800'
      case 'company': return 'bg-blue-100 text-blue-800'
      case 'driver': return 'bg-green-100 text-green-800'
      case 'user': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getRoleIcon = (role) => {
    switch (role) {
      case 'admin': return <BarChart3 className="h-5 w-5" />
      case 'company': return <Package className="h-5 w-5" />
      case 'driver': return <Truck className="h-5 w-5" />
      case 'user': return <Users className="h-5 w-5" />
      default: return <Users className="h-5 w-5" />
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <SimulatorBanner />
      
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
              Welcome back, {user?.name}!
            </h2>
            <div className="flex items-center space-x-3">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(user?.role)}`}>
                {getRoleIcon(user?.role)}
                <span className="ml-1">{user?.role?.toUpperCase()}</span>
              </span>
              <button
                onClick={logout}
                className="flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <div className="bg-gray-50 overflow-hidden rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Package className="h-6 w-6 text-gray-400" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Total Orders
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      0
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-100 px-5 py-3">
              <div className="text-sm">
                <a href="/orders" className="font-medium text-indigo-600 hover:text-indigo-500">
                  View all orders →
                </a>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 overflow-hidden rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Truck className="h-6 w-6 text-gray-400" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Live Shipping Simulator
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      Test Now
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-100 px-5 py-3">
              <div className="text-sm">
                <a href="/simulator" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Try simulator →
                </a>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 overflow-hidden rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <Truck className="h-6 w-6 text-gray-400" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Active Deliveries
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      0
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-100 px-5 py-3">
              <div className="text-sm">
                <a href="#" className="font-medium text-indigo-600 hover:text-indigo-500">
                  Manage drivers →
                </a>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 overflow-hidden rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <BarChart3 className="h-6 w-6 text-gray-400" aria-hidden="true" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">
                      Performance
                    </dt>
                    <dd className="text-lg font-medium text-gray-900">
                      98%
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
            <div className="bg-gray-100 px-5 py-3">
              <div className="text-sm">
                <a href="#" className="font-medium text-indigo-600 hover:text-indigo-500">
                  View analytics →
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Recent Activity
          </h3>
          <div className="mt-5 bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:p-6">
              <div className="text-center text-gray-500">
                No recent activity to display
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
