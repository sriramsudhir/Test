<template>
  <div
    class="glide"
    ref="glide"
  >
    <slot name="bullet-area">
      <ul
        v-if="bullets"
        class="glide-bullets"
        data-glide-el="controls[nav]"
      >
        <li
          v-for="index in imageCount"
          :key="index"
          :data-glide-dir="`=${index - 1}`"
        />
      </ul>
    </slot>
    <div
      data-glide-el="controls"
      class="glide-nav"
    >
      <button
        aria-label="prev"
        class="prev-btn"
        data-glide-dir="<"
      >
        <i
          class="m-0 icon arrow-left"
        />
      </button>
      <button
        class="next-btn"
        aria-label="next"
        data-glide-dir=">"
      >
        <i
          class="m-0 icon arrow-right"
        />
      </button>
    </div>
    <div
      data-glide-el="track"
      class="glide__track"
    >
      <ul
        class="glide__slides"
      >
        <slot
          name="content"
        />
      </ul>
    </div>
  </div>
</template>

<script>
  import Glide from '@glidejs/glide'

  export default {
    name: 'ImageSlider',
    data() {
      return {
        glide: null
      }
    },
    watch: {},
    props: {
      activeSlide: {
        type: Number,
        default: 0
      },
      imageCount: {
        type: Number,
        default: 0
      },
      perView: {
        type: Number,
        default: 1
      },
      responsive: {
        type: Array,
        default(){
          return [1, 1, 1, 1, 1]
        }
      },
      gap: {
        type: Number,
        default: 1
      },
      loop: {
        type: Boolean,
        default: false
      },
      bullets: {
        type: Boolean,
        default: false
      },
      autoplay: {
        type: Number,
        default: 0
      },
      lazyImage: {
        type: Boolean,
        default: false
      }
    },
    components: {},
    computed: {
      currentPerView(){
        return this.glide?.settings?.perView
      }
    },
    mixins: [],
    methods: {
      changeSlide(index){
        this.glide.go(`=${index}`)
      },
      sliderInit() {
        this.glide = new Glide(this.$refs.glide, {
          startAt: this.activeSlide,
          perView: this.perView,
          autoplay: this.autoplay,
          gap: this.gap,
          perTouch: 3,
          bound: true,
          rewind: this.loop,
          breakpoints: {
            1200: {
              perView: this.responsive[0]
            },
            992: {
              perView: this.responsive[1]
            },
            768: {
              perView: this.responsive[2]
            },
            576: {
              perView: this.responsive[3],
              gap: 10
            },
            360: {
              perView: this.responsive[4],
              gap: 10
            }
          }
        })

        if(!this.bullets){
          this.$nextTick(() => {
            const step = this.currentPerView
            this.glide.on('run.before', (evt) => {
              evt.steps = evt.direction === '>' ? -step : step
            })
          })
        }

        if(this.lazyImage) {
          this.$nextTick(() => {
            this.glide.on('run.before', (evt) => {

              if(this.imageCount - 1 >= this.glide.index) {

                if(evt.direction === '='){
                  //FOR BULLETS CLICKS
                  this.$emit('change', {index: evt.steps - 1, direction: 1})
                } else {
                  //FOR ARROW CLICKS
                  this.$emit('change', {index: this.glide.index, direction: (evt.direction === '>') ? 1: -1})
                }


              }
            })
          })
        }

        this.glide.on('mount.after', () => {
          setTimeout(() => {
            this.$emit('loaded', this.glide.index)
          }, 50)
        })

        this.$emit('glide', this.glide)
        this.glide.mount()
      }


    },
    created() {
    },
    mounted() {
      this.$nextTick(() => {
        this.sliderInit()
      })

    }
  }
</script>

