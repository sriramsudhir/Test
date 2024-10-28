<template>
  <div
    class="pop-over"
    :class="{'has-layer': hasLayer}"
  >
    <div
      class="layer"
      :data-ignore="elemId"
      @click.prevent="closePopOver"
    />
    <div
      class="pop-over-inner"
      :id="elemId"
      v-outside-click="outsideClickFn"
    >
      <div
        v-if="title"
        class="pop-heading flex sided plr-20 plr-sm-15 ptb-10 b-b pos-rel"
      >
        <slot name="heading">
          <h5 class="bold">
            {{ title }}
          </h5>
        </slot>
        <button
          class="right-btn close-btn pos-static no-shadow"
          aria-label="submit"
          @click.prevent="closePopOver"
        >
          <i
            class="icon close-icon"
          />
        </button>
      </div>
      <div
        class="sb pop-over-content p-20 p-sm-15"
      >
        <slot
          name="content"
        />
      </div>
      <div
        v-if="hasFooterSlot"
        class="pop-footer b-t plr-20 plr-sm-15 pt-10 pb-10"
      >
        <slot
          name="pop-footer"
        />
      </div>
    </div>
  </div>
</template>

<script>
  import outsideClick from '~/directives/outside-click.js'

  export default {
    name: 'PopOver',
    components: {},
    directives: {outsideClick},
    props: {
      title: {
        type: String,
        default: '',
      },
      elemId: {
        type: String,
        default: '',
      },
      layer: {
        type: Boolean,
        default: false,
      },
      outsideClickOn: {
        type: Boolean,
        default: true,
      },
      layerOnResponsive: {
        type: Boolean,
        default: true,
      }
    },
    computed: {
      isSmallerDevice(){
        return window.innerWidth < 992
      },
      hasFooterSlot() {
        return !!this.$slots['pop-footer']
      }
    },
    data() {
      return {
        hasLayer: this.layer,
      }
    },
    methods: {
      outsideClickFn(){
        if(this.outsideClickOn){
          this.closePopOver()
        }
      },
      closePopOver() {
        this.$emit('close')
      }
    },
    mounted() {
      if(this.isSmallerDevice && this.layerOnResponsive){
        this.hasLayer = true
      }
      if (this.hasLayer) {
        document.body.classList.add('no-scroll')
      }
    },
    destroyed() {
      document.body.classList.remove('no-scroll')
    }
  }
</script>
