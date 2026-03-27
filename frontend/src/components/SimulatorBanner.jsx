import React from 'react'
import { Link } from 'react-router-dom'
import { Play, Truck, Zap } from 'lucide-react'

function SimulatorBanner() {
  return (
    <div className="bg-gradient-to-r from-green-600 to-blue-600 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <Zap className="h-6 w-6 text-yellow-300 animate-pulse" />
              <Truck className="h-8 w-8 ml-2" />
            </div>
            <div>
              <h2 className="text-lg font-bold">🚀 LIVE SHIPPING SIMULATOR</h2>
              <p className="text-sm text-green-100">Watch real-time delivery tracking in action!</p>
            </div>
          </div>
          <Link
            to="/simulator"
            className="flex items-center bg-white text-green-600 px-6 py-3 rounded-lg font-semibold hover:bg-green-50 transition-colors transform hover:scale-105"
          >
            <Play className="h-5 w-5 mr-2" />
            START NOW
          </Link>
        </div>
      </div>
    </div>
  )
}

export default SimulatorBanner
