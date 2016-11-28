import Events from 'minivents'
import AnimationBus from 'animation-bus'
import PagerElement from './PagerElement'
import { modulo, clamp, sum, max, range } from './utils'

class View extends PagerElement {
  constructor({ index, ...restOptions }) {
    super(restOptions)
    this.index = index
    this.isCurrent = false
    this.setTarget()
    this.setOrigin()
  }

  setTarget() {
    let target = this.pager.getStartCoords(this.index)

    if (this.pager.options.align) {
      target += this.pager.getAlignOffset(this)
    }

    this.target = target
  }

  setOrigin(trackPosition = this.pager.trackPosition) {
    this.origin = this.target - trackPosition
  }
}

class Pager extends Events {
  constructor(options = {}) {
    super()

    this.options = {
      viewsToShow: 'auto',
      viewsToMove: 1,
      align: 0,
      contain: false,
      axis: 'x',
      fixedSize: false, // true, false, 'width', 'height'
      autoSize: false,
      animations: [],
      infinite: false,
      instant: false,
      swipe: true,
      swipeThreshold: 0.5,
      flickTimeout: 300,
      accessibility: true,
      ...options
    }

    this.views = []
    this.currentIndex = 0
    this.currentView = null
    this.currentTween = 0
    this.trackPosition = 0
    this.isSwiping = false
    this.animationBus = new AnimationBus({
      animations: this.options.animations,
      origin: view => view.origin
    })

    if (typeof window === 'undefined') {
      return
    } else {
      window.addEventListener('resize', this.resize)
    }
  }

  setOptions(options) {
    // spread new options over the old ones
    this.options = {
      ...this.options,
      ...options
    }

    // merge animations into animation bus
    this.animationBus.animations = this.options.animations
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
  }

  resize = () => {
    this.hydrate()
    this.emit('resize')
  }

  hydrate = () => {
    this.frame && this.frame.setSize()
    this.track && this.track.setSize()
    this.views.forEach(view => {
      view.setSize()
      view.setTarget()
    })
    this.setPositionValue()
    this.setViewStyles()
    this.emit('hydrated')
  }

  addFrame(node) {
    this.frame = new PagerElement({ node, pager: this })
    this.hydrate()
  }

  addTrack(node) {
    this.track = new PagerElement({ node, pager: this })
    this.hydrate()
  }

  addView(node) {
    const index = this.views.length
    const view = new View({
      node,
      index,
      pager: this
    })

    // add view to collection
    this.views.push(view)

    // set this as the first view if there isn't one yet
    if (!this.currentView) {
      this.setCurrentView(0, index, true)
    }

    // fire an event
    this.emit('viewAdded')

    // with each view added we need to re-calculate widths and positions
    this.hydrate()

    return view
  }

  removeView(view) {
    // filter out view
    this.views = this.views.filter(_view => view !== _view)

    // fire an event
    this.emit('viewRemoved')

    // re-calculate view positions
    this.hydrate()
  }

  prev() {
    this.setCurrentView(-1)
  }

  next() {
    this.setCurrentView(1)
  }

  setCurrentView(direction = 0, index = this.currentIndex, suppressEvent) {
    const { viewsToMove, infinite } = this.options
    const newIndex = index + (direction * viewsToMove)

    const previousIndex = this.currentIndex
    const currentIndex = infinite ? newIndex : clamp(newIndex, 0, this.views.length - 1)

    const previousView = this.getView(previousIndex)
    const currentView = this.getView(currentIndex)

    // set current index and view
    this.currentIndex = currentIndex
    this.currentView = currentView

    // swap current view flags
    previousView.isCurrent = false
    currentView.isCurrent = true

    // set the track position to the new view
    this.setPositionValue()

    if (!suppressEvent) {
      const viewsToShow = this.getNumericViewsToShow()
      const viewCount = this.views.length

      this.emit('viewChange', {
        from: range(previousIndex, previousIndex + viewsToShow, viewCount),
        to: range(currentIndex, currentIndex + viewsToShow, viewCount)
      })
    }
  }

  setPositionValue(trackPosition = this.currentView ? this.currentView.target : 0) {
    if (!this.isSwiping) {
      const { viewsToShow, autoSize, infinite, contain } = this.options
      const trackSize = this.getTrackSize()

      if (infinite) {
        // we offset by a track multiplier so infinite animation can take advantage of
        // physics by animating to a large value, the final value provided in getTransformValue
        // will return the proper wrapped value
        trackPosition -= (Math.floor(this.currentIndex / this.views.length) || 0) * trackSize
      }

      if (contain) {
        const trackEndOffset = ((viewsToShow === 'auto' && autoSize) || viewsToShow <= 1)
          ? 0 : this.getFrameSize({ autoSize: false, fixedSize: false })
        trackPosition = clamp(trackPosition, trackEndOffset - trackSize, 0)
      }
    }

    this.trackPosition = trackPosition
  }

  setViewStyles(trackPosition = 0) {
    const { infinite, align } = this.options
    const frameSize = this.getFrameSize()
    const trackSize = this.getTrackSize()
    const wrappedtrackPosition = modulo(trackPosition, -trackSize)

    this.views.reduce((lastPosition, view, index) => {
      const viewSize = view.getSize()
      const nextPosition = lastPosition + viewSize
      let position = lastPosition

      if (infinite) {
        // shift views around so they are always visible in frame
        if (nextPosition + (viewSize * align) < Math.abs(wrappedtrackPosition)) {
          position += trackSize
        } else if (lastPosition > (frameSize - wrappedtrackPosition)) {
          position -= trackSize
        }
      }

      view.setPosition(position)
      view.setOrigin(trackPosition)

      return nextPosition
    }, 0)
  }

  getNumericViewsToShow() {
    return isNaN(this.options.viewsToShow) ? 1 : this.options.viewsToShow
  }

  getMaxDimensions(indices) {
    const { axis } = this.options
    const widths = []
    const heights = []

    indices.forEach(index => {
      const view = isNaN(index) ? index : this.getView(index)
      widths.push(view.getSize('width'))
      heights.push(view.getSize('height'))
    })

    return {
      width: (axis === 'x') ? sum(widths) : max(widths),
      height: (axis === 'y') ? sum(heights) : max(heights)
    }
  }

  getFrameSize({
    autoSize = this.options.autoSize,
    fixedSize = this.options.fixedSize,
    fullSize = false
  } = {}) {
    const { infinite, contain, axis } = this.options
    let dimensions = {
      width: 0,
      height: 0
    }

    if (this.views.length) {
      if (autoSize) {
        // gather all current indices depending on options
        const currentViews = []
        const viewsToShow = isNaN(this.options.viewsToShow) ? 1 : this.options.viewsToShow
        let minIndex = this.currentIndex
        let maxIndex = this.currentIndex + (viewsToShow - 1)

        if (contain) {
          // if containing, we need to clamp the start and end indexes so we only return what's in view
          minIndex = clamp(minIndex, 0, this.views.length - viewsToShow)
          maxIndex = clamp(maxIndex, 0, this.views.length - 1)
          for (let i = minIndex; i <= maxIndex; i++) {
            currentViews.push(i)
          }
        } else {
          for (let i = minIndex; i <= maxIndex; i++) {
            currentViews.push(infinite
              ? modulo(i, this.views.length)
              : clamp(i, 0, this.views.length - 1)
            )
          }
        }
        dimensions = this.getMaxDimensions(currentViews)
      } else if (fixedSize) {
        dimensions = this.getMaxDimensions(this.views)
      } else if (this.frame) {
        dimensions = {
          width: this.frame.getSize('width'),
          height: this.frame.getSize('height')
        }
      }
    }

    if (fullSize) {
      return dimensions
    } else {
      return dimensions[axis === 'x' ? 'width' : 'height']
    }
  }

  getTrackSize(includeLastSlide = true) {
    const lastIndex = includeLastSlide ? this.views.length : this.views.length - 1
    let size = 0
    this.views.slice(0, lastIndex).forEach(view => {
      size += view.getSize()
    })
    return size
  }

  getView(index) {
    return this.views[modulo(index, this.views.length)]
  }

  // where the view should start
  getStartCoords(index) {
    let target = 0
    this.views.slice(0, index).forEach(view => {
      target -= view.getSize()
    })
    return target
  }

  // how much to offset the view defined by the align option
  getAlignOffset(view) {
    const frameSize = this.getFrameSize({ autoSize: false })
    const viewSize = view.getSize()
    return (frameSize - viewSize) * this.options.align
  }

  getPositionValue(trackPosition = this.trackPosition) {
    const { infinite, contain } = this.options
    const position = { x: 0, y: 0 }

    // store the current animated value so we can reference it later
    this.currentTween = trackPosition

    // wrap the track position if this is an infinite track
    if (infinite) {
      const trackSize = this.getTrackSize()
      trackPosition = modulo(trackPosition, -trackSize) || 0
    }

    // emit a "scroll" event so we can do things based on the progress of the track
    this.emit('scroll', {
      progress: trackPosition / this.getTrackSize(false),
      position: trackPosition
    })

    // set the proper transform axis based on our options
    position[this.options.axis] = trackPosition

    return position
  }

  resetViews() {
    // reset back to a normal index
    this.setCurrentView(0, modulo(this.currentIndex, this.views.length), true)
  }
}

export default Pager