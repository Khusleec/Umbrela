import React, { useState, useEffect } from 'react'
import { Truck, Package, MapPin, Clock, Play, Pause, RotateCcw } from 'lucide-react'

function ShippingSimulator() {
  const [isRunning, setIsRunning] = useState(false)
  const [currentStatus, setCurrentStatus] = useState('pending')
  const [driverPosition, setDriverPosition] = useState({ x: 10, y: 50 })
  const [orderProgress, setOrderProgress] = useState(0)
  const [estimatedTime, setEstimatedTime] = useState(45)

  const statusSteps = [
    { status: 'pending', label: 'Order Placed', icon: Package, progress: 0 },
    { status: 'assigned', label: 'Driver Assigned', icon: Truck, progress: 20 },
    { status: 'picked_up', label: 'Package Picked Up', icon: Package, progress: 40 },
    { status: 'on_the_way', label: 'On the Way', icon: Truck, progress: 70 },
    { status: 'delivered', label: 'Delivered', icon: Package, progress: 100 }
  ]

  useEffect(() => {
    let interval
    if (isRunning && currentStatus !== 'delivered') {
      interval = setInterval(() => {
        setOrderProgress(prev => {
          const newProgress = prev + 2
          if (newProgress >= 100) {
            setCurrentStatus('delivered')
            setIsRunning(false)
            return 100
          }
          return newProgress
        })

        setDriverPosition(prev => {
          const newX = prev.x + 2
          if (newX > 90) return { x: 90, y: prev.y }
          return { x: newX, y: 50 + Math.sin(newX * 0.1) * 10 }
        })

        setEstimatedTime(prev => Math.max(0, prev - 1))

        // Update status based on progress
        if (orderProgress >= 70 && currentStatus !== 'on_the_way') {
          setCurrentStatus('on_the_way')
        } else if (orderProgress >= 40 && currentStatus !== 'picked_up') {
          setCurrentStatus('picked_up')
        } else if (orderProgress >= 20 && currentStatus !== 'assigned') {
          setCurrentStatus('assigned')
        }
      }, 500)
    }

    return () => clearInterval(interval)
  }, [isRunning, currentStatus, orderProgress])

  const resetSimulation = () => {
    setIsRunning(false)
    setCurrentStatus('pending')
    setDriverPosition({ x: 10, y: 50 })
    setOrderProgress(0)
    setEstimatedTime(45)
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'assigned': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'picked_up': return 'bg-purple-100 text-purple-800 border-purple-200'
      case 'on_the_way': return 'bg-indigo-100 text-indigo-800 border-indigo-200'
      case 'delivered': return 'bg-green-100 text-green-800 border-green-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const currentStep = statusSteps.find(step => step.status === currentStatus)
  const CurrentIcon = currentStep?.icon || Package

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Live Shipping Simulator</h1>
            <div className="flex space-x-2">
              <button
                onClick={() => setIsRunning(!isRunning)}
                disabled={currentStatus === 'delivered'}
                className={`flex items-center px-4 py-2 rounded-md text-white font-medium ${
                  currentStatus === 'delivered' 
                    ? 'bg-gray-400 cursor-not-allowed' 
                    : isRunning 
                      ? 'bg-orange-600 hover:bg-orange-700' 
                      : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isRunning ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                {isRunning ? 'Pause' : 'Start'}
              </button>
              <button
                onClick={resetSimulation}
                className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-medium"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </button>
            </div>
          </div>

          {/* Current Status Card */}
          <div className={`border-2 rounded-lg p-4 mb-6 ${getStatusColor(currentStatus)}`}>
            <div className="flex items-center">
              <CurrentIcon className="h-8 w-8 mr-3" />
              <div>
                <h2 className="text-xl font-semibold">{currentStep?.label}</h2>
                <p className="text-sm opacity-80">
                  {currentStatus === 'delivered' 
                    ? 'Package successfully delivered!' 
                    : `Estimated delivery in ${estimatedTime} minutes`
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Order Progress</span>
              <span>{orderProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${orderProgress}%` }}
              />
            </div>
          </div>

          {/* Status Timeline */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4">Delivery Timeline</h3>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-300"></div>
              {statusSteps.map((step, index) => {
                const StepIcon = step.icon
                const isActive = statusSteps.findIndex(s => s.status === currentStatus) >= index
                const isCurrent = step.status === currentStatus
                
                return (
                  <div key={step.status} className="relative flex items-center mb-4">
                    <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 z-10 ${
                      isCurrent 
                        ? 'bg-blue-600 border-blue-600' 
                        : isActive 
                          ? 'bg-green-600 border-green-600' 
                          : 'bg-white border-gray-300'
                    }`}>
                      <StepIcon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                    </div>
                    <div className="ml-4">
                      <p className={`font-medium ${isActive ? 'text-gray-900' : 'text-gray-500'}`}>
                        {step.label}
                      </p>
                      {isCurrent && (
                        <p className="text-sm text-gray-600">
                          {currentStatus === 'delivered' ? 'Completed at ' + new Date().toLocaleTimeString() : 'In progress...'}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live Map Simulation */}
          <div className="bg-gray-100 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-4">Live Tracking Map</h3>
            <div className="relative bg-white rounded-lg h-64 border-2 border-gray-200">
              {/* Pickup Location */}
              <div className="absolute left-8 top-1/2 transform -translate-y-1/2">
                <div className="flex flex-col items-center">
                  <Package className="h-6 w-6 text-blue-600" />
                  <span className="text-xs mt-1 bg-blue-100 text-blue-800 px-2 py-1 rounded">Pickup</span>
                </div>
              </div>

              {/* Delivery Location */}
              <div className="absolute right-8 top-1/2 transform -translate-y-1/2">
                <div className="flex flex-col items-center">
                  <MapPin className="h-6 w-6 text-green-600" />
                  <span className="text-xs mt-1 bg-green-100 text-green-800 px-2 py-1 rounded">Delivery</span>
                </div>
              </div>

              {/* Route Line */}
              <svg className="absolute inset-0 w-full h-full">
                <line
                  x1="10%"
                  y1="50%"
                  x2="90%"
                  y2="50%"
                  stroke="#e5e7eb"
                  strokeWidth="2"
                  strokeDasharray="5,5"
                />
              </svg>

              {/* Driver/Truck */}
              <div 
                className="absolute transition-all duration-500 ease-out"
                style={{ 
                  left: `${driverPosition.x}%`, 
                  top: `${driverPosition.y}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <div className="relative">
                  <Truck className="h-8 w-8 text-orange-600" />
                  {isRunning && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  )}
                </div>
              </div>

              {/* Distance and Time Info */}
              <div className="absolute bottom-4 left-4 bg-white rounded-lg p-2 shadow-md">
                <div className="flex items-center text-sm">
                  <Clock className="h-4 w-4 mr-1 text-gray-500" />
                  <span className="font-medium">{estimatedTime} min</span>
                </div>
              </div>

              {/* Speed Indicator */}
              {isRunning && (
                <div className="absolute bottom-4 right-4 bg-white rounded-lg p-2 shadow-md">
                  <div className="flex items-center text-sm">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                    <span className="font-medium">Live</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Order Details */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">Order Details</h4>
              <div className="space-y-1 text-sm">
                <p className="text-gray-600">Order #12345</p>
                <p className="text-gray-600">Weight: 2.5 kg</p>
                <p className="text-gray-600">Priority: Standard</p>
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">Driver Info</h4>
              <div className="space-y-1 text-sm">
                <p className="text-gray-600">John Driver</p>
                <p className="text-gray-600">Vehicle: Van</p>
                <p className="text-gray-600">License: ABC-123</p>
              </div>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">Addresses</h4>
              <div className="space-y-1 text-sm">
                <p className="text-gray-600">From: Warehouse A</p>
                <p className="text-gray-600">To: Customer B</p>
                <p className="text-gray-600">Distance: 12.5 km</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ShippingSimulator
