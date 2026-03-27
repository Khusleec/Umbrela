import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { io } from 'socket.io-client'
import axios from 'axios'
import { MapPin, Truck, Clock, CheckCircle, AlertCircle } from 'lucide-react'

function Tracking() {
  const { orderId } = useParams()
  const [order, setOrder] = useState(null)
  const [driverLocation, setDriverLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [socket, setSocket] = useState(null)

  useEffect(() => {
    fetchOrder()
    const newSocket = io('http://localhost:3002') // Order service WebSocket
    setSocket(newSocket)

    newSocket.emit('subscribe:order', orderId)

    newSocket.on('order:orderId', (data) => {
      if (data.action === 'status_updated') {
        setOrder(prev => ({ ...prev, ...data.order }))
      }
    })

    return () => {
      newSocket.disconnect()
    }
  }, [orderId])

  useEffect(() => {
    if (order?.driver_id && socket) {
      const driverSocket = io('http://localhost:3003') // Driver service WebSocket
      driverSocket.emit('subscribe:driver:location', order.driver_id)

      driverSocket.on('driver:orderId:location', (data) => {
        setDriverLocation(data.location)
      })

      return () => {
        driverSocket.disconnect()
      }
    }
  }, [order?.driver_id])

  const fetchOrder = async () => {
    try {
      const response = await axios.get(`/api/orders/${orderId}`)
      setOrder(response.data)
    } catch (error) {
      console.error('Failed to fetch order:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'assigned': return 'bg-blue-100 text-blue-800'
      case 'picked_up': return 'bg-purple-100 text-purple-800'
      case 'on_the_way': return 'bg-indigo-100 text-indigo-800'
      case 'delivered': return 'bg-green-100 text-green-800'
      case 'cancelled': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'delivered': return <CheckCircle className="h-5 w-5" />
      case 'cancelled': return <AlertCircle className="h-5 w-5" />
      default: return <Clock className="h-5 w-5" />
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-lg">Loading tracking information...</div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Order Not Found</h2>
          <p className="mt-2 text-gray-600">The order you're looking for doesn't exist.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-semibold text-gray-900">
                  Tracking Order #{orderId}
                </h1>
              </div>
            </div>
            <div className="flex items-center">
              <a
                href="/dashboard"
                className="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                ← Back to Dashboard
              </a>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Order Status */}
          <div className="lg:col-span-2">
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Order Status
                </h3>
                
                <div className="space-y-4">
                  <div className="flex items-center">
                    <span className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium ${getStatusColor(order.status)}`}>
                      {getStatusIcon(order.status)}
                      <span className="ml-2">{order.status.replace('_', ' ').toUpperCase()}</span>
                    </span>
                  </div>

                  <div className="border-t border-gray-200 pt-4">
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                      <div className="sm:col-span-1">
                        <dt className="text-sm font-medium text-gray-500">
                          Created
                        </dt>
                        <dd className="mt-1 text-sm text-gray-900">
                          {new Date(order.created_at).toLocaleString()}
                        </dd>
                      </div>
                      {order.estimated_delivery_time && (
                        <div className="sm:col-span-1">
                          <dt className="text-sm font-medium text-gray-500">
                            Estimated Delivery
                          </dt>
                          <dd className="mt-1 text-sm text-gray-900">
                            {new Date(order.estimated_delivery_time).toLocaleString()}
                          </dd>
                        </div>
                      )}
                      {order.actual_delivery_time && (
                        <div className="sm:col-span-1">
                          <dt className="text-sm font-medium text-gray-500">
                            Actual Delivery
                          </dt>
                          <dd className="mt-1 text-sm text-gray-900">
                            {new Date(order.actual_delivery_time).toLocaleString()}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            {/* Addresses */}
            <div className="bg-white shadow rounded-lg mt-6">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Delivery Details
                </h3>
                
                <div className="space-y-4">
                  <div className="flex items-start">
                    <MapPin className="h-5 w-5 text-gray-400 mr-3 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Pickup Address</p>
                      <p className="text-sm text-gray-600">{order.pickup_address}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start">
                    <MapPin className="h-5 w-5 text-gray-400 mr-3 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Delivery Address</p>
                      <p className="text-sm text-gray-600">{order.delivery_address}</p>
                    </div>
                  </div>

                  {order.notes && (
                    <div className="border-t border-gray-200 pt-4">
                      <p className="text-sm font-medium text-gray-900">Notes</p>
                      <p className="text-sm text-gray-600">{order.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Real-time Tracking */}
          <div className="lg:col-span-1">
            <div className="bg-white shadow rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                  Real-time Tracking
                </h3>
                
                {driverLocation ? (
                  <div className="space-y-4">
                    <div className="flex items-center">
                      <Truck className="h-5 w-5 text-green-500 mr-2" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Driver Location</p>
                        <p className="text-xs text-gray-600">
                          Lat: {driverLocation.lat.toFixed(6)}, Lng: {driverLocation.lng.toFixed(6)}
                        </p>
                        <p className="text-xs text-gray-500">
                          Last updated: {new Date().toLocaleTimeString()}
                        </p>
                      </div>
                    </div>

                    {/* Simple Map Placeholder */}
                    <div className="map-container">
                      <div className="text-center">
                        <MapPin className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600">Live Map View</p>
                        <p className="text-xs text-gray-500">
                          Driver location tracking active
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500">
                    <Truck className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm">Driver location not available</p>
                    <p className="text-xs text-gray-400">
                      Order may not be assigned yet
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default Tracking
