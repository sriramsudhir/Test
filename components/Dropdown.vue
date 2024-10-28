<template>
  <div
    class="custom-dropdown"
    :class="[{'open': dropdownOpen}, position]"
  >
    <span
      :data-ignore="currentId"
      :class="{disabled: disabled}"
      @click.prevent="openDropdown"
    >
      <span>{{ selectedValue }}</span>
      <i
        class="icon black ignore-click"
        :class="[{'arrow-up': dropdownOpen}, {'arrow-down': !dropdownOpen}]"
      />
    </span>
    <div
      v-if="dropdownOpen"
      class="dropdown-wrapper"
    >
      <div
        v-if="hasLayer"
        class="layer"
        :data-ignore="currentId"
        @click="closeDropdown"
      />
      <div
        class="dropdown-inner sb"
        v-outside-click="closeDropdown"
        :id="currentId"
      >
        <input
          v-if="searching"
          ref="searcBox"
          type="text"
          v-model="searched"
        >
        <ul>
          <li
            v-for="(data, index) in opt"
            :key="index"
            :class="{active: `${selectedKeyData}` === `${index}`}"
            @click.prevent="clicked(index, data)"
          >
            {{ data[keyName] }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
  import outsideClick from '~/directives/outside-click';

  export default {
    name: 'Dropdown',
    data() {
      return {
        optionsData: this.options,
        searched: '',
        dropdownOpen: false,
        hasLayer: this.layer,
        scrollPosition: 0,
        selectedKeyData: ''
      }
    },
    mounted() {
      this.selectedKeyData = this.selectedKey
      this.processSelected(this.options)
    },
    watch: {
      options(value) {
        this.processSelected(value)
      },
      selectedKey(value) {
        this.selectedKeyData = value
      },
      searched(value) {
        this.doSearch(value)
      },
    },
    props: {
      position: {
        type: String,
        default: 'left'
      },
      disabled: {
        type: Boolean,
        default: false
      },
      defaultNull: {
        type: Boolean,
        default: false
      },
      nullSelectable: {
        type: Boolean,
        default: false
      },
      positionFixed: {
        type: Boolean,
        default: true
      },
      defaultValue: {
        type: Object,
        default() {
          return {key: '0', value: this.$t('dropdown.choose') }
        }
      },
      options: {
        type: Object,
        default() {
          return {'0': {title: this.$t('dropdown.choose') }}
        }
      },
      selectedKey: {
        default() {
          return Object.keys(this.options)[0]
        }
      },
      keyName: {
        type: String,
        default: 'title'
      },
      searching: {
        type: Boolean,
        default: false
      },
      layer: {
        type: Boolean,
        default: false,
      }
    },
    directives: {
      outsideClick
    },
    computed: {
      currentId() {
        return `dropdown-${this._uid}`
      },
      isSmallerDevice() {
        return window.innerWidth <= 768
      },
      opt() {
        return this.optionsData ?? null
      },
      currentKey() {
        if (this.selectedKeyData && this.options[this.selectedKeyData]) {
          return this.selectedKeyData
        } else {
          return Object.keys(this.optionsData)[0]
        }
      },
      selectedValue() {
        if (this.opt && this.opt[this.currentKey] && this.opt[this.currentKey][this.keyName])
          return this.opt[this.currentKey][this.keyName]
        else
          return this.$t('dropdown.choose')
      }
    },
    methods: {
      processSelected(value){
        if (!this.selectedKey && !this.defaultNull) {
          this.selectedKeyData = Object.keys(value)[0]
          this.$emit('clicked', {
            key: this.selectedKeyData,
            value: Object.values(value)[0]
          })
        } else if(this.defaultNull){
          value[this.defaultValue.key] = {title: this.defaultValue.value}
          this.selectedKeyData = this.defaultValue.key
        }
        this.optionsData = value
      },
      doSearch(query) {
        this.optionsData = {}
        const object = this.options

        for (const property in object) {
          if (object[property][this.keyName].toLowerCase().includes(query.toLowerCase()))
            this.opt[property] = object[property]
        }
      },
      openDropdown() {
        if(this.disabled){
          return false
        }
        if (this.isSmallerDevice) {
          this.hasLayer = true
        }
        if (this.hasLayer && this.positionFixed) {
          document.body.classList.add('no-scroll')
        }
        this.dropdownOpen = !this.dropdownOpen
        this.$emit('value', this.dropdownOpen)
        if (this.searching && this.dropdownOpen) {
          this.$nextTick(() => {
            this.$refs.searcBox.focus()
          })
        }
      },
      closeDropdown() {
        if (this.positionFixed) {
          document.body.classList.remove('no-scroll')
        }
        this.dropdownOpen = false
        this.$emit('value', this.dropdownOpen)
      },
      clicked(index, obj) {
        this.closeDropdown()
        this.searched = ''

        if ((index !== this.defaultValue.key && this.currentKey !== index) || this.nullSelectable) {

          const prev = this.selectedKeyData

          this.selectedKeyData = index
          this.$emit('clicked', {
            key: index,
            value: obj,
            prev: prev
          })
        }
      }
    }
  }
</script>
