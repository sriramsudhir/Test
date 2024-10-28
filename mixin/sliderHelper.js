export default {
  data() {
    return {
      currentSlider: this.activeId  || 0,
      glide: null
    }
  },
  methods: {
    changed({index, direction}){
      if(index + direction < 0) {
        return false
      }

      const self = this
      const img = this.loadedImage(index + direction)


      const setLoadingState = () => {
        img.style.opacity = 1
      }

      img?.addEventListener('load', setLoadingState)
      img?.addEventListener('error', () => {
        img.style.opacity = 1
        img.src = self?.getImageURL()
      })
    },
    firstImgLoaded(index = 0){
      const self = this
      const img = this.loadedImage(index)

      const setLoadingState = () => {
        img.style.opacity = 1
        this.imgLoaded = true
      }

      img?.addEventListener('load', setLoadingState)
      img?.addEventListener('error', () => {
        img.style.opacity = 1
        const firstImg = document.getElementById(this.generateElemId(index))
        firstImg?.setAttribute('src', self?.getImageURL())
      })
    },
    loadedImage(index = 0) {
      const firstImg = document.getElementById(this.generateElemId(index))
      firstImg?.setAttribute('src', firstImg?.getAttribute('data-source'))
      return firstImg
    },
    generateElemId(index) {
      return `${this._uid}--${index}`
    },
    loadImage(index) {
      const self = this
      const currentImg = document.getElementById(this.generateElemId(index))
      const dataSrc = currentImg?.getAttribute('data-src') || null

      if (dataSrc) {
        currentImg.src = dataSrc
        currentImg.onload = function () {
          currentImg.removeAttribute('data-src')
        }
        currentImg.onerror = function () {
          currentImg.src = self.imageURL()
        }
      }
    },
    glideSlider(data) {
      data.on('run', function () {
        this.loadImage(data.index)
        this.currentSlider = data.index
      }.bind(this))
    }
  }
}
